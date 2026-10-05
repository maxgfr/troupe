// Public barrel of the `library` module — other modules import ONLY from here.
export {
  addTextItem,
  addArticleItem,
  addFileItem,
  listItems,
  getItem,
  itemFiles,
  updateItem,
  requeueItem,
  deleteItem,
  searchLibrary,
  voiceProfile,
  listLibraryMessages,
  clearLibraryMessages,
  sendLibraryMessage,
  listIdeas,
  deleteIdea,
  generateIdeas,
  createProjectFromIdea,
  kindForMime,
  MAX_TEXT_CHARS,
} from "./server/service";
export type { LibraryItemView, LibraryItemDetail, SearchHit, SearchResult, LibraryMessageView, IdeaView, Writer } from "./server/service";
export { analyzeItem, claimNextItem, requeueStale, runLibraryQueue, embedMissing, spread, thumbnailOf } from "./server/analyze";
export type { AnalysisOptions } from "./server/analyze";
export { libraryItems, libraryChunks, libraryMessages, libraryIdeas } from "./server/schema";
export * from "./model";
export { IDEA_KINDS, languageName, cleanTags } from "./prompts";
export type { IdeaKind } from "./prompts";
export { formatTimestamp, chunkText, chunkTranscript, cosine, rankByCosine, keywordScore, hookFromText, hookFromTranscript, pacingOf, styleProfile, keywordTags } from "./text";
export { frameTimes, cutsFromDifferences } from "./frames";
