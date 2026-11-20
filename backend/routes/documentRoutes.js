import express from "express";
import {
    uploadDocument,
    getDocuments,
    getSingleDocument,
    deleteDocument,
    saveDocumentMetadata
} from "../controllers/documentController.js";
import protect from "../middlewares/auth.js";
import upload from "../config/multer.js";

const router = express.Router();

// All Routes are Protected

router.use(protect);

// Frontend calls this to get the ticket (named uploadDocument!)
router.post('/upload', uploadDocument);

// Frontend calls this after direct-uploading to Supabase to save to MongoDB
router.post('/save-metadata', saveDocumentMetadata);
router.get("/", getDocuments);
router.get("/:id", getSingleDocument);
router.delete("/:id", deleteDocument);

export default router;