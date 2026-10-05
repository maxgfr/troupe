import type { AnswerSchema, ChatModel, ChatTurn } from "~/modules/chat";
import type { Embedder } from "~/modules/library";

// A bag-of-words embedding: passages that share words point the same way.
export function fakeEmbedder(model = "fake-embed"): Embedder {
  return {
    model,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Array(64).fill(0);
        for (const word of text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2)) {
          let h = 0;
          for (const c of word) h = (h * 31 + c.charCodeAt(0)) % 64;
          v[h] += 1;
        }
        return v;
      });
    },
  };
}

// Answers each library request in the shape its schema asks for.
export function fakeWriter(seen: ChatTurn[][] = []): ChatModel {
  return {
    async propose(messages, { schema }) {
      seen.push(messages);
      const required = (schema as AnswerSchema & { required: string[] }).required;
      let answer: unknown;
      if (required.includes("summary")) answer = { summary: "A barista shows a cold brew trick.", hook_why: "It opens on a bold claim.", structure: [{ part: "hook", start_s: 0, summary: "Bold claim" }, { part: "cta", start_s: 18, summary: "Follow" }], tone: ["Playful", "direct"], tags: ["#Coffee", "cold brew", "Coffee"] };
      else if (required.includes("answer")) answer = { answer: "It opens on a bold claim about coffee [1].", sources: [1] };
      else answer = { ideas: [1, 2, 3].map((n) => ({ title: `Idea ${n}`, hook: `Hook ${n}?`, lines: [{ role: "body", text: `Hook ${n}?`, emotion: "excited" }, { role: "body", text: "**Middle** line.", emotion: "neutral" }, { role: "body", text: "Follow for more.", emotion: "happy" }] })) };
      return { text: JSON.stringify(answer), proposal: answer };
    },
  };
}

