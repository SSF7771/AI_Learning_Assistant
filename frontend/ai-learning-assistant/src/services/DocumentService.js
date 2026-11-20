import axiosInstance from "../utils/axiosInstance.js";
import { API_PATHS } from "../utils/apiPaths.js";

const getDocuments = async () => {
  try {
    const response = await axiosInstance.get(API_PATHS.DOCUMENT.GET_DOCUMENTS);

    return response.data?.data;
  } catch (error) {
    throw (
      error.response?.data || {
        message: "An unknown error occurred!",
      }
    );
  }
};

const getUploadSignedUrl = async (fileName, title) => {
  try {
    const response = await axiosInstance.post(API_PATHS.DOCUMENT.UPLOAD, {
      fileName,
      title,
    });
    return response.data; // Returns { success, signedUrl, path, publicUrl }
  } catch (error) {
    throw error.response?.data || { message: "Failed to get upload URL" };
  }
};

// Save document metadata to MongoDB after Supabase upload is finished
const saveDocumentMetadata = async (metadata) => {
  try {
    const response = await axiosInstance.post(
      API_PATHS.DOCUMENT.SAVE_METADATA,
      metadata,
    );
    return response.data;
  } catch (error) {
    throw (
      error.response?.data || { message: "Failed to save document metadata" }
    );
  }
};

const deleteDocument = async (id) => {
  try {
    const response = await axiosInstance.delete(
      API_PATHS.DOCUMENT.DELETE_DOCUMENT(id),
    );

    return response.data;
  } catch (error) {
    throw (
      error.response?.data || {
        message: "An unknown error occurred!",
      }
    );
  }
};

const getDocumentById = async (id) => {
  try {
    const response = await axiosInstance.get(
      API_PATHS.DOCUMENT.GET_DOCUMENTS_BY_ID(id),
    );

    return response.data;
  } catch (error) {
    throw (
      error.response?.data || {
        message: "An unknown error occurred!",
      }
    );
  }
};

const documentService = {
  getDocuments,
  getUploadSignedUrl,
  saveDocumentMetadata,
  deleteDocument,
  getDocumentById,
};

export default documentService;
