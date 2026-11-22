import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { chunkText, findRelevantChunks } from "./textChunker.js";

dotenv.config();

// USE THIS INSIDE THE FUNCTIONS
// const ai = new GoogleGenAI({
//     apiKey: process.env.GEMINI_API_KEY
// });

if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: API KEY is not set in the env variables!");
  process.exit(1);
}

/**
 * Shared helper for both Flashcards & Quizzes:
 * - If `topic` is given: selects relevant chunks matching the keywords.
 * - If `topic` is empty: picks diverse random chunks spread across the text.
 */
const getTextSample = (text, topic = "", limit = 15000) => {
  if (!text || text.trim().length === 0) {
    throw new Error("No text provided.");
  }

  const cleanTopic = topic.trim();

  if (cleanTopic.length > 0) {
    // TOPIC-BASED SELECTION (using keywords)
    const chunks = chunkText(text, 400, 40);
    const normalizedQuery = cleanTopic.replace(/[,;|]+/g, " ");
    const relevantChunks = findRelevantChunks(chunks, normalizedQuery, 12);

    if (relevantChunks.length === 0) {
      throw new Error(`No content found matching topic: "${cleanTopic}"`);
    }

    // Keep top 2 most relevant chunks, shuffle the rest for variety
    const guaranteed = relevantChunks.slice(0, 2);
    const rest = relevantChunks.slice(2).sort(() => Math.random() - 0.5);
    const orderedPool = [...guaranteed, ...rest];

    const selected = [];
    let totalChars = 0;

    for (const chunk of orderedPool) {
      if (totalChars + chunk.content.length > limit && selected.length > 0) {
        break;
      }
      selected.push(chunk);
      totalChars += chunk.content.length;
    }

    selected.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return selected.map((c) => c.content).join("\n\n");
  }

  // DIVERSE RANDOM SAMPLING (when no topic is specified)
  if (text.length <= limit) return text;

  const chunks = chunkText(text, 400, 0);
  if (chunks.length === 0) {
    const maxStart = text.length - limit;
    const randomStart = Math.floor(Math.random() * maxStart);
    return text.substring(randomStart, randomStart + limit);
  }

  const targetBuckets = Math.min(8, chunks.length);
  const bucketSize = Math.ceil(chunks.length / targetBuckets);
  const buckets = [];

  for (let i = 0; i < chunks.length; i += bucketSize) {
    const bucket = chunks.slice(i, i + bucketSize);
    buckets.push([...bucket].sort(() => Math.random() - 0.5));
  }

  const selected = [];
  let totalChars = 0;
  let round = 0;
  let addedInRound = true;

  while (addedInRound && totalChars < limit) {
    addedInRound = false;
    for (const bucket of buckets) {
      if (round < bucket.length) {
        const chunk = bucket[round];
        if (
          totalChars + chunk.content.length <= limit ||
          selected.length === 0
        ) {
          selected.push(chunk);
          totalChars += chunk.content.length;
          addedInRound = true;
        }
      }
      if (totalChars >= limit) break;
    }
    round++;
  }

  selected.sort((a, b) => a.chunkIndex - b.chunkIndex);
  return selected.map((c) => c.content).join("\n\n");
};

/**
 * Generate Flashcards from text
 * @param {string} text - Document text
 * @param {number} count - Number of flashcards to generate
 * @param {string} [topic=""] - Optional topic or keywords to focus on
 * @returns {Promise<Array<{question: string, answer: string, difficulty: string}>>}
 */
export const generateFlashCards = async (text, count = 10, topic = "") => {
  const cleanTopic = topic.trim();
  const textSample = getTextSample(text, cleanTopic, 15000);

  const focusInstruction = cleanTopic
    ? `IMPORTANT: Focus specifically on the topic/keywords: "${cleanTopic}". Every flashcard MUST relate to this topic. Ensure a mix of terminology, conceptual understanding, and application.`
    : `IMPORTANT: Focus on different concepts than usual. Ensure a mix of terminology, conceptual understanding, and application.`;

  const prompt = `Generate exactly ${count} educational flashcards from the following text.
    ${focusInstruction}
    Format each flashcard as:
    Q: [Clear, specific question]
    A: [Concise, accurate answer]
    D: [Difficulty level: easy, medium, or hard]

    Separate each flashcard with "---"

    Text:
    ${textSample}
    `;

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = response.text;

    // Parse the response
    const flashcards = [];
    const cards = generatedText.split("---").filter((c) => c.trim());

    for (const card of cards) {
      const lines = card.trim().split("\n");
      let question = "",
        answer = "",
        difficulty = "medium";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("Q:"))
          question = trimmedLine.substring(2).trim();
        else if (trimmedLine.startsWith("A:"))
          answer = trimmedLine.substring(2).trim();
        else if (trimmedLine.startsWith("D:")) {
          const diff = trimmedLine.substring(2).trim().toLowerCase();

          if (["easy", "medium", "hard"].includes(diff)) difficulty = diff;
        }
      }

      if (question && answer) {
        flashcards.push({
          question,
          answer,
          difficulty,
        });
      }
    }

    return flashcards.slice(0, count);
  } catch (error) {
    console.error("Gemini API Error: ", error);
    throw new Error("Failed to generate flashcards!");
  }
};

// Helper to guarantee correctAnswer is stored as the actual option text (e.g. "Greedy Method")
const resolveOptionText = (rawAnswer, options) => {
  if (!rawAnswer || options.length !== 4) return rawAnswer;
  const trimmed = rawAnswer.trim();

  // Already matches one of the 4 options directly
  const directMatch = options.find(
    (opt) => opt.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  if (directMatch) return directMatch;

  // Matches "O3", "O3: Greedy Method", "Option 3", etc.
  const labelMatch = trimmed.match(
    /^(?:O|Option\s*)([1-4])(?:\s*[:.)-]\s*.*)?$/i,
  );
  if (labelMatch) {
    return options[parseInt(labelMatch[1], 10) - 1];
  }

  // Matches bare "1".."4" when not literally an option
  const numMatch = trimmed.match(/^([1-4])$/);
  if (numMatch) {
    return options[parseInt(numMatch[1], 10) - 1];
  }

  return trimmed;
};

/**
 * Generate Quiz questions
 * @param {string} text - Document text
 * @param {number} numQuestions - Number of questions
 * @param {string} [topic=""] - Optional topic or keywords to focus on
 * @returns {Promise<Array<{question: string, options: Array, correctAnswer: string, explanation: string, difficulty: string}>>}
 */
export const generateQuiz = async (text, numQuestions = 5, topic = "") => {
  const cleanTopic = topic.trim();
  const textSample = getTextSample(text, cleanTopic, 15000);

  const focusInstruction = cleanTopic
    ? `IMPORTANT: Focus specifically on the topic/keywords: "${cleanTopic}". Every question MUST relate to this topic. Ensure a mix of terminology, conceptual understanding, and application.`
    : `IMPORTANT: Focus on different concepts than usual. Ensure a mix of terminology, conceptual understanding, and application.`;

  const prompt = `Generate exactly ${numQuestions} multiple choice questions from the following text.
    ${focusInstruction}
    Format each question as:
    Q: [Question]
    O1: [Option 1]
    O2: [Option 2]
    O3: [Option 3]
    O4: [Option 4]
    C: [Exact text of the correct option - write the answer text itself, NOT O1/O2/O3/O4]
    E: [Brief explanation]
    D: [Difficulty: easy, medium, or hard]

    Separate each question with "---"

    Text:
    ${textSample}
    `;

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = response.text;

    // Parse the response
    const questions = [];
    const questionBlocks = generatedText.split("---").filter((q) => q.trim());

    for (const block of questionBlocks) {
      const lines = block.trim().split("\n");
      let question = "",
        options = [],
        correctAnswer = "",
        explanation = "",
        difficulty = "medium";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Q:")) question = trimmed.substring(2).trim();
        else if (trimmed.match(/^O\d:/))
          options.push(trimmed.substring(3).trim());
        else if (trimmed.startsWith("C:"))
          correctAnswer = trimmed.substring(2).trim();
        else if (trimmed.startsWith("E:"))
          explanation = trimmed.substring(2).trim();
        else if (trimmed.startsWith("D:")) {
          const diff = trimmed.substring(2).trim().toLowerCase();

          if (["easy", "medium", "hard"].includes(diff)) difficulty = diff;
        }
      }

      correctAnswer = resolveOptionText(correctAnswer, options);

      if (question && options.length === 4 && correctAnswer) {
        questions.push({
          question,
          options,
          correctAnswer,
          explanation,
          difficulty,
        });
      }
    }

    return questions.slice(0, numQuestions);
  } catch (error) {
    console.error("Gemini API Error: ", error);
    throw new Error("Failed to generate quizzes!");
  }
};

/**
 * Generate document Summary
 * @param {string} text - Document text
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * @param {string} text - Part of the document that wants to be summarized
 * @returns {Promise<string>}
 */

export const generateSummary = async (text) => {
  const prompt = `Provide a concise summary of the following text, highlighting the key concepts, main ideas, and crucial points.
    Keep the summary clear and structured.
    Text:
    ${text.substring(0, 20000)}
    `;

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = response.text;

    return generatedText;
  } catch (error) {
    console.error("Gemini API Error: ", error);
    throw new Error("Failed to generate summary!");
  }
};

/**
 * Chat with document context
 * @param {string} question - User question
 * @param {Array<Object>} chunks - Relevant document chunks
 * @returns {Promise<string>}
 */

export const chatWithContext = async (question, chunks) => {
  const context1 = chunks
    .map((c, i) => `[Chunks ${i + 1}\n${c.content}]`)
    .join("\n\n");
  // const context2 =

  const prompt = `Based on the following context from a document, Analyze the context and answer the user's question accurately.
    If the answer is not in the context, say so.
    
    Context:
    ${context1}

    Question: ${question}

    Answer:
    `;

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = response.text;

    return generatedText;
  } catch (error) {
    console.error("Gemini API Error: ", error);
    throw new Error("Failed to generate summary!");
  }
};

/**
 * @param {string} concept - Concept to explain
 * @param {string} context - Relevant Chunks
 * @returns {Promise<string>}
 *
 */

export const explainConcept = async (concept, context) => {
  const prompt = `Explain the concept of ${concept} based on the following context.
    Provide a clear, educational explanation that's easy to understand.
    Include examples if relevant.
    
    Context:
    ${context.substring(0, 10000)}
    `;

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = response.text;

    return generatedText;
  } catch (error) {
    console.error("Gemini API Error: ", error);
    throw new Error("Failed to explain concept.");
  }
};
