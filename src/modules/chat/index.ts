// Public barrel of the `chat` module — other modules import ONLY from here.
export {
  sendChatMessage,
  listChatMessages,
  applyChatProposal,
  getChatSettings,
  saveChatSettings,
  ChatSettingsPatch,
  ChatMessageNotFoundError,
  NothingToApplyError,
} from "./server/service";
export type { ChatMessageView } from "./server/service";
export { buildChatPrompt, repairTurn, HISTORY_TURNS } from "./prompt";
export type { ChatPromptInput } from "./prompt";
export {
  proposalJsonSchema,
  StoredProposal,
  checkProposal,
  parseJsonAnswer,
  countWords,
  wordBudget,
  spoken,
  LINE_ROLES,
  MAX_LINES,
} from "./proposal";
export type { Proposal, ActorChoice, ProposalJsonSchema } from "./proposal";
export { diffLines } from "./diff";
export type { LineChange } from "./diff";
export { CHAT_PROVIDERS, ChatProviderError } from "./model";
export type {
  AnswerSchema,
  ChatModel,
  ChatTurn,
  ChatAnswer,
  ChatSetup,
  ChatProviderId,
  ChatSettings,
  ChatSettingsView,
  ChatBackend,
  ChatConnectionReport,
} from "./model";
export { chatMessages } from "./server/schema";
