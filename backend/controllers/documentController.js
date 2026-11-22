import Document from "../models/Document.js";
import Flashcard from "../models/Flashcard.js";
import Quiz from "../models/Quiz.js";
import { extractTextFromPDF } from "../utils/pdfParser.js";
import { chunkText } from "../utils/textChunker.js";
import fs from "fs/promises";
import mongoose from "mongoose";
// import cloudinary from "../config/cloudinary.js";
import { supabase } from "../config/supabase.js"; // Adjust path as needed
import crypto from "crypto";

// pdfParser & textChunker -> Alat bantu untuk mengubah file mentah (PDF) menjadi format data teks
// yang siap diolah oleh mesin pencari atau sistem AI.
// fs / promises -> Digunakan untuk berinteraksi dengan sistem penyimpanan file server
// (seperti menghapus file saat dokumen dihapus dari aplikasi).
// uploadDocument -> Mengelola proses unggah file PDF. Fungsi ini mengekstraksi teks menggunakan extractTextFromPDF,
// membagi teks menjadi potongan kecil dengan chunkText agar mudah diproses AI, lalu menyimpan informasi tersebut ke dalam model Document.
// getDocuments -> Berfungsi untuk mengambil seluruh daftar dokumen yang telah diunggah oleh user dari database
// untuk ditampilkan pada halaman listing document.
// getSingleDocument -> Mengambil data detail dari satu dokumen spesifik berdasarkan ID-nya.
// Fungsi ini digunakan untuk menampilkan isi dokumen atau metadata lengkap di halaman document details.
// deleteDocument -> Menghapus data dokumen dari database secara permanen.
// Fungsi ini juga bertugas menghapus file fisik di penyimpanan server (menggunakan fs) serta membersihkan data terkait seperti Flashcard dan Quiz yang terhubung dengan dokumen tersebut.

//@desc -> Upload PDF document
//@route -> POST /api/document/upload
//@access PRIVATE
// GENERATE SIGNED URL (Bypasses Vercel 4.5MB limit)
export const uploadDocument = async (req, res, next) => {
  try {
    const { fileName, title } = req.body;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        error: "Please provide a file name!",
        statusCode: 400,
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Please provide a document title!",
        statusCode: 400,
      });
    }

    // Generate a safe, unique file name to avoid overlaps
    const fileExtension = fileName.split(".").pop();
    const uniqueFileName = `${crypto.randomUUID()}.${fileExtension}`;
    const filePath = `documents/${uniqueFileName}`; // Folder path inside your bucket

    // Create a Supabase Signed Upload URL (Bypasses Vercel's 4.5MB limit!)
    const { data, error } = await supabase.storage
      .from("uploads") // Your bucket name
      .createSignedUploadUrl(filePath);

    if (error)
      throw new Error(`Failed to generate upload URL: ${error.message}`);

    // Construct the final public URL where the file will live after frontend uploads it
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${filePath}`;

    // Send the signed URL and tokens back to the frontend
    res.status(200).json({
      success: true,
      signedUrl: data.signedUrl, // Frontend uses this to upload directly
      path: filePath,
      publicUrl: publicUrl, // Frontend sends this back when saving metadata
      message: "Signed upload URL generated successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// SAVE METADATA (Called after frontend successfully uploads direct to Supabase)
export const saveDocumentMetadata = async (req, res, next) => {
  try {
    const { title, fileName, filePath, fileSize } = req.body;

    if (!title || !filePath)
      return res
        .status(400)
        .json({ success: false, error: "Title and file path are required" });

    const document = await Document.create({
      userId: req.user._id,
      title,
      fileName,
      filePath, // The public Supabase URL
      fileSize: fileSize || 0,
      status: "processing",
      docType: "private",
    });

    // Trigger your background PDF processing (if you have one)
    await processPdf(document._id, filePath);

    res.status(201).json({
      success: true,
      data: document,
      message:
        "Document metadata saved successfully. Processing in progress...",
    });
  } catch (error) {
    next(error);
  }
};

// Helper FUNCTION for process PDF
const processPdf = async (documentId, fileUrl) => {
  try {
    const { text, pages, numPages } = await extractTextFromPDF(fileUrl);

    if (!text || text.trim().length === 0) {
      throw new Error(
        "No extractable text found in PDF (it may be scanned/image-only).",
      );
    }

    // Pass 'pages' instead of 'text' so pageNumber is tracked accurately
    const chunks = chunkText(pages, 500, 50);

    // Update document
    await Document.findByIdAndUpdate(documentId, {
      extractedText: text,
      chunks: chunks,
      status: "ready",
    });

    console.log(
      `Document ${documentId} processed successfully (${chunks.length} chunks across ${numPages} pages)!`,
    );
  } catch (error) {
    console.error(`Error processing document ${documentId}: `, error);

    await Document.findByIdAndUpdate(documentId, {
      status: "failed",
    });
  }
};

//@desc -> Get All User's Documents
//@route -> GET /api/document
//@access PRIVATE
export const getDocuments = async (req, res, next) => {
  try {
    const documents = await Document.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user._id),
          docType: "private",
        },
      },
      {
        $lookup: {
          from: "flashcards",
          localField: "_id",
          foreignField: "documentId",
          as: "flashcardSets",
        },
      },
      {
        $lookup: {
          from: "quizzes",
          localField: "_id",
          foreignField: "documentId",
          as: "quizzes",
        },
      },
      {
        $addFields: {
          flashcardCount: {
            $size: "$flashcardSets",
          },
          quizCount: {
            $size: "$quizzes",
          },
        },
      },
      {
        $project: {
          extractedText: 0,
          chunks: 0,
          flashcardSets: 0,
          quizzes: 0,
        },
      },
      {
        $sort: {
          uploadDate: -1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents,
    });
  } catch (error) {
    next(error);
  }
};

//@desc -> Get A Single User's Document
//@route -> GET /api/document/:id
//@access PRIVATE
export const getSingleDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found!",
        statusCode: 404,
      });
    }

    // Get counts of associated flashcards and quizzes
    const flashcardCount = await Flashcard.countDocuments({
      documentId: document._id,
      userId: req.user._id,
    });

    const quizCount = await Quiz.countDocuments({
      documentId: document._id,
      userId: req.user._id,
    });

    // Update last accessed
    document.lastAccessed = Date.now();

    await document.save();

    // Combine document data with counts
    const documentData = document.toObject();
    documentData.flashcardCount = flashcardCount;
    documentData.quizCount = quizCount;

    res.status(200).json({
      success: true,
      data: documentData,
    });
  } catch (error) {
    next(error);
  }
};

//@desc -> Delete A Single User's Document
//@route -> DELETE /api/document/:id
//@access PRIVATE
export const deleteDocument = async (req, res, next) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!document) {
      return res.status(404).json({
        success: false,
        error: "Document not found!",
        statusCode: 404,
      });
    }

    // If a file URL exists in Supabase Storage, delete it to save space
    if (document.filePath) {
      try {
        // Extract the relative path from the Supabase public URL
        // Example URL: https://xyz.supabase.co/storage/v1/object/public/uploads/documents/uuid.pdf
        // We need: documents/uuid.pdf
        const urlParts = document.filePath.split("/uploads/");

        if (urlParts.length > 1) {
          const filePath = urlParts[1]; // e.g., "documents/uuid.pdf" or "learning_pdfs/uuid.pdf"

          const { error: storageError } = await supabase.storage
            .from("uploads")
            .remove([filePath]);

          if (storageError) {
            console.error(
              "Failed to delete file from Supabase storage:",
              storageError.message,
            );
          }
        }
      } catch (storageErr) {
        // Non-blocking: Log it so deletion of the record can still proceed if needed
        console.error("Error parsing/deleting file from Supabase:", storageErr);
      }
    }

    // Delete Document record from MongoDB
    await document.deleteOne();

    res.status(200).json({
      success: true,
      message: "Document deleted successfully!",
    });
  } catch (error) {
    next(error);
  }
};
