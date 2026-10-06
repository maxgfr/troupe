// Public barrel of the `library` module — other modules import ONLY from here.
export { addTextItem, addArticleItem, addFileItem, listItems, getItem, itemFiles, updateItem, requeueItem, deleteItem, searchLibrary, voiceProfile, kindForMime, MAX_TEXT_CHARS } from "./server/items";
export type { LibraryItemView, LibraryItemDetail, SearchHit, SearchResult } from "./server/items";
export { listLibraryMessages, clearLibraryMessages, sendLibraryMessage } from "./server/chat";
export type { LibraryMessageView } from "./server/chat";
export { listIdeas, deleteIdea, generateIdeas, createProjectFromIdea } from "./server/ideas";
export type { IdeaView } from "./server/ideas";
export type { Writer } from "./server/writer";
export { analyzeItem, claimNextItem, requeueStale, runLibraryQueue, embedMissing, spread, thumbnailOf, HEARTBEAT_MS, STALE_AFTER_MS, MAX_ATTEMPTS } from "./server/analyze";
export type { AnalysisOptions } from "./server/analyze";
export { libraryItems, libraryChunks, libraryMessages, libraryIdeas } from "./server/schema";
export * from "./model";
export { IDEA_KINDS, languageName, cleanTags } from "./prompts";
export type { IdeaKind } from "./prompts";
export { formatTimestamp, chunkText, chunkTranscript, cosine, rankByCosine, keywordScore, hookFromText, hookFromTranscript, pacingOf, styleProfile, keywordTags } from "./text";
export { frameTimes, cutsFromDifferences } from "./frames";
