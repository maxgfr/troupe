import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// WebLLM's side of the chat (site/src/chat/webllm.ts): the model, its WebGPU
// device and its generation loop live here, off the page's main thread.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => handler.onmessage(message);
