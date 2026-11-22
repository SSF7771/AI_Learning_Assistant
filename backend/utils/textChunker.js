/**
 * Clean text while preserving single/double newlines
 * @param {string} rawText
 * @returns {string}
 */
const cleanTextPreserveStructure = (rawText) => {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ") // Collapse spaces/tabs, keep \n
    .replace(/ *\n */g, "\n")  // Trim spaces around newlines
    .replace(/\n{3,}/g, "\n\n") // Collapse 3+ newlines to 2
    .trim();
};

/**
 * Split oversized text by sentences first, falling back to words
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} overlap
 * @returns {string[]}
 */
const splitLargeBlock = (text, chunkSize, overlap) => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  const result = [];
  let currentWords = [];

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).filter(Boolean);

    // Single sentence exceeds chunkSize -> split by words
    if (sentenceWords.length > chunkSize) {
      if (currentWords.length > 0) {
        result.push(currentWords.join(" "));
        currentWords = [];
      }
      for (let i = 0; i < sentenceWords.length; i += chunkSize - overlap) {
        result.push(sentenceWords.slice(i, i + chunkSize).join(" "));
        if (i + chunkSize >= sentenceWords.length) break;
      }
      continue;
    }

    if (currentWords.length + sentenceWords.length > chunkSize && currentWords.length > 0) {
      result.push(currentWords.join(" "));
      const overlapWords = overlap > 0 ? currentWords.slice(-overlap) : [];
      currentWords = [...overlapWords, ...sentenceWords];
    } else {
      currentWords.push(...sentenceWords);
    }
  }

  if (currentWords.length > 0) {
    result.push(currentWords.join(" "));
  }

  return result;
};

/**
 * Split text or pages into chunks while tracking page numbers
 * @param {string | Array<{pageNumber: number, text: string}>} input
 * @param {number} chunkSize - Target size per chunk (in words)
 * @param {number} overLap - Number of words to overlap between chunks
 * @returns {Array<{content: string, chunkIndex: number, pageNumber: number, pageNumbers: number[]}>}
 */
export const chunkText = (input, chunkSize = 500, overLap = 50) => {
  if (!input) return [];

  // Prevent invalid sizes / infinite loops
  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(overLap, safeChunkSize - 1));

  // Normalize input into [{ pageNumber, text }]
  let pages = [];
  if (typeof input === "string") {
    if (input.trim().length === 0) return [];
    // Split on PDF form-feed (\f) if present; otherwise treat as page 1
    pages = input.split("\f").map((pageText, idx) => ({
      pageNumber: idx + 1,
      text: pageText,
    }));
  } else if (Array.isArray(input)) {
    pages = input.map((p, idx) => ({
      pageNumber: p.pageNumber ?? idx + 1,
      text: p.text ?? "",
    }));
  }

  // Extract paragraphs while keeping each paragraph's pageNumber
  const paragraphs = [];
  for (const page of pages) {
    const cleaned = cleanTextPreserveStructure(page.text);
    if (!cleaned) continue;

    for (const p of cleaned.split(/\n+/)) {
      const trimmed = p.trim();
      if (trimmed.length > 0) {
        paragraphs.push({ text: trimmed, pageNumber: page.pageNumber });
      }
    }
  }

  if (paragraphs.length === 0) return [];

  const chunks = [];
  let currentSegments = []; // { text, pageNumber, isOverlap }
  let currentWordCount = 0;
  let chunkIndex = 0;

  const flushCurrentChunk = () => {
    if (currentSegments.length === 0) return;

    // Primary page = first non-overlap segment's page (falls back to first segment)
    const primarySegment =
      currentSegments.find((s) => !s.isOverlap) || currentSegments[0];

    const pageNumbers = [
      ...new Set(currentSegments.map((s) => s.pageNumber)),
    ];

    chunks.push({
      content: currentSegments.map((s) => s.text).join("\n\n"),
      chunkIndex: chunkIndex++,
      pageNumber: primarySegment.pageNumber,
      pageNumbers, // Useful if a chunk spans multiple pages
    });
  };

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.text.split(/\s+/);
    const paragraphWordCount = paragraphWords.length;

    // Case 1: Single paragraph exceeds chunkSize -> split by sentences/words
    if (paragraphWordCount > safeChunkSize) {
      flushCurrentChunk();
      currentSegments = [];
      currentWordCount = 0;

      const subChunks = splitLargeBlock(
        paragraph.text,
        safeChunkSize,
        safeOverlap
      );
      for (const content of subChunks) {
        chunks.push({
          content,
          chunkIndex: chunkIndex++,
          pageNumber: paragraph.pageNumber,
          pageNumbers: [paragraph.pageNumber],
        });
      }
      continue;
    }

    // Case 2: Adding paragraph exceeds chunkSize -> flush & start new chunk with overlap
    if (
      currentWordCount + paragraphWordCount > safeChunkSize &&
      currentSegments.length > 0
    ) {
      flushCurrentChunk();

      let nextSegments = [];
      let overlapWordCount = 0;

      if (safeOverlap > 0) {
        const lastSegment = currentSegments[currentSegments.length - 1];
        const prevWords = currentSegments
          .map((s) => s.text)
          .join(" ")
          .split(/\s+/);
        const overlapWords = prevWords.slice(
          -Math.min(safeOverlap, prevWords.length)
        );

        if (overlapWords.length > 0) {
          nextSegments.push({
            text: overlapWords.join(" "),
            pageNumber: lastSegment.pageNumber,
            isOverlap: true,
          });
          overlapWordCount = overlapWords.length;
        }
      }

      nextSegments.push({
        text: paragraph.text,
        pageNumber: paragraph.pageNumber,
        isOverlap: false,
      });

      currentSegments = nextSegments;
      currentWordCount = overlapWordCount + paragraphWordCount;
    } else {
      // Case 3: Fits into current chunk
      currentSegments.push({
        text: paragraph.text,
        pageNumber: paragraph.pageNumber,
        isOverlap: false,
      });
      currentWordCount += paragraphWordCount;
    }
  }

  // Flush the final remaining chunk (outside the loop!)
  flushCurrentChunk();

  return chunks;
};

/**
 * Find relevant chunks based on keyword matching
 * @param { Array<Object> } chunks - Array of chunks
 * @param { string } query - Search query
 * @param { number } maxChunks - Max Chunks to return
 * @returns {Array<Object>}
 * */

export const findRelevantChunks = (chunks, query, maxChunks = 3) => {
  if (!chunks || chunks.length === 0 || !query) return [];

  // Common stop words to exclude
  const stopWords = new Set([
    "the",
    "is",
    "at",
    "which",
    "on",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "with",
    "to",
    "for",
    "of",
    "as",
    "by",
    "this",
    "that",
    "it",
  ]);

  // Extract and clean query words
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (queryWords.length === 0) {
    // Return clean chunk objects without Mongoose metadata
    return chunks.slice(0, maxChunks).map(chunk => ({
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber,
      _id: chunk._id,
    }));
  }

  const scoredChunks = chunks.map((chunk, idx) => {
    const content = chunk.content.toLowerCase();
    const contentWords = content.split(/\s+/).length;
    let score = 0;

    // Score each query word
    for (const word of queryWords) {
      // Exact word match (higher score)
      const exactMatches = (
        content.match(new RegExp(`\\b${word}\\b`, "g")) || []
      ).length;
      score += exactMatches * 3;

      // Partial match (lower score)
      const partialMatches = (content.match(new RegExp(word, "g")) || [])
        .length;
      score += Math.max(0, partialMatches - exactMatches) * 1.5;
    }

    // Bonus: Multiple query words found
    const uniqueWordsFound = queryWords.filter((word) =>
      content.includes(word)
    ).length;

    if (uniqueWordsFound > 1) score += uniqueWordsFound * 2;

    // Normalize by content length
    const normalizedScore = score / Math.sqrt(contentWords);

    // Small bonus for earlier chunks
    const positionBonus = 1 - (idx / chunks.length) * 0.1;

    // Return clean object without Mongoose metadata
    return {
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber,
      _id: chunk._id,
      score: normalizedScore * positionBonus,
      rawScore: score,
      matchedWords: uniqueWordsFound,
    };
  });

  const candidatePoolSize = maxChunks * 3;

  const topScoredChunks = scoredChunks
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.matchedWords - a.matchedWords;
    })
    .slice(0, candidatePoolSize); // Take a pool of candidates

  // Randomly shuffle the pool and then take the maxChunks
  return topScoredChunks
    .sort(() => Math.random() - 0.5) // Simple shuffle
    .slice(0, maxChunks);
};
