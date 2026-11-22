import axios from "axios";
import pdf from "pdf-parse-fork";

/**
 * Extract text and per-page content from a PDF file URL
 * @param {string} fileUrl - URL to the PDF file
 * @returns {Promise<{text: string, pages: Array<{pageNumber: number, text: string}>, numPages: number, info: Object}>}
 */
export const extractTextFromPDF = async (fileUrl) => {
  try {
    // Fetch the PDF from Cloudinary / Supabase as an arraybuffer
    const response = await axios.get(fileUrl, {
      responseType: "arraybuffer",
    });

    const dataBuffer = Buffer.from(response.data);
    const pages = [];

    const options = {
      pagerender: async (pageData) => {
        const renderOptions = {
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        };

        const textContent = await pageData.getTextContent(renderOptions);
        let lastY;
        let pageText = "";

        for (const item of textContent.items) {
          if (lastY == item.transform[5] || !lastY) {
            pageText += item.str;
          } else {
            pageText += "\n" + item.str;
          }
          lastY = item.transform[5];
        }

        const pageNumber =
          pageData.pageNumber ??
          (typeof pageData.pageIndex === "number"
            ? pageData.pageIndex + 1
            : pages.length + 1);

        // Push every page (even if blank) so subsequent page numbers don't shift
        pages.push({
          pageNumber,
          text: pageText,
        });

        return pageText;
      },
    };

    const data = await pdf(dataBuffer, options);

    // Ensure pages are strictly ordered by pageNumber
    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    return {
      text: data.text,
      pages,
      numPages: data.numpages,
      info: data.info,
    };
  } catch (error) {
    console.error("PDF parsing error: ", error);
    throw new Error("Failed to extract text from PDF.");
  }
};