import type { Pace, TranscriptSegment } from "./model";

// Pure text work for the library: passages to embed, similarity, keyword
// search, hooks, pacing and the "in my voice" profile. No I/O: the same code
// runs on the server and in the browser edition.

export interface TimedPassage {
  text: string;
  startS: number;
  endS: number;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// Paragraphs packed up to `maxChars`; a longer paragraph is split on its
// sentences, and a sentence longer still is cut at the limit.
export function chunkText(text: string, { maxChars = 700 }: { maxChars?: number } = {}): string[] {
  const out: string[] = [];
  const pack = (pieces: string[], glue: string) => {
    let current = "";
    for (const piece of pieces) {
      if (piece.length > maxChars) {
        if (current) out.push(current);
        current = "";
        for (let at = 0; at < piece.length; at += maxChars) out.push(piece.slice(at, at + maxChars));
        continue;
      }
      const joined = current ? `${current}${glue}${piece}` : piece;
      if (joined.length <= maxChars) current = joined;
      else {
        out.push(current);
        current = piece;
      }
    }
    if (current) out.push(current);
  };

  let current: string[] = [];
  const flush = () => {
    if (current.length) pack(current, "\n\n");
    current = [];
  };
  for (const raw of text.split(/\n\s*\n/)) {
    const paragraph = raw.replace(/[ \t]+/g, " ").trim();
    if (!paragraph) continue;
    if (paragraph.length > maxChars) {
      flush();
      pack(
        paragraph
          .split(/(?<=[.!?…])\s+/)
          .map(squash)
          .filter(Boolean),
        " ",
      );
    } else current.push(paragraph);
  }
  flush();
  return out;
}

// Transcript segments grouped into passages of at most `maxChars` and
// `maxSpanS`, each keeping its start and end; a segment longer than a
// passage is split with times in proportion to its text.
export function chunkTranscript(
  segments: readonly TranscriptSegment[],
  { maxChars = 500, maxSpanS = 45 }: { maxChars?: number; maxSpanS?: number } = {},
): TimedPassage[] {
  const out: TimedPassage[] = [];
  let current: TimedPassage | null = null;
  for (const segment of segments) {
    const text = squash(segment.text);
    if (!text) continue;
    if (text.length > maxChars) {
      if (current) out.push(current);
      current = null;
      const pieces = chunkText(text, { maxChars });
      const span = Math.max(0, segment.endS - segment.startS);
      let done = 0;
      for (const piece of pieces) {
        const startS = segment.startS + (span * done) / text.length;
        done += piece.length;
        out.push({ text: piece, startS: round2(startS), endS: round2(segment.startS + (span * done) / text.length) });
      }
      continue;
    }
    if (current && current.text.length + 1 + text.length <= maxChars && segment.endS - current.startS <= maxSpanS) {
      current = { text: `${current.text} ${text}`, startS: current.startS, endS: segment.endS };
    } else {
      if (current) out.push(current);
      current = { text, startS: segment.startS, endS: segment.endS };
    }
  }
  if (current) out.push(current);
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

// Exact nearest neighbours: every candidate is scored. A personal library
// holds thousands of passages, not millions (docs/LIBRARY.md).
export function rankByCosine<T extends { embedding: readonly number[] }>(
  query: readonly number[],
  candidates: readonly T[],
  limit: number,
): { item: T; score: number }[] {
  return candidates
    .map((item) => ({ item, score: cosine(query, item.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Lowercase words without accents, for keyword matching.
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// How many times the query's words appear in the text (each counted up to
// three times): the search when no embedding model is available.
export function keywordScore(query: string, text: string): number {
  const terms = [...new Set(words(query).filter((w) => w.length > 1 && !STOPWORDS.has(w)))];
  if (terms.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of words(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return terms.reduce((sum, term) => sum + Math.min(3, counts.get(term) ?? 0), 0);
}

// The hook: what is said in the first `seconds`, in whole segments (Whisper
// cuts on phrases): every segment that starts in the window and is said
// mostly inside it, and at least the first one.
export function hookFromTranscript(
  segments: readonly TranscriptSegment[],
  seconds = 3,
): { text: string; endS: number } | null {
  const spoken = segments.filter((s) => s.text.trim());
  const first = spoken[0];
  if (!first || first.startS >= seconds * 2) return null;
  const inside = spoken.filter((s, i) => i === 0 || (s.startS < seconds && (s.startS + s.endS) / 2 <= seconds));
  return {
    text: inside.map((s) => squash(s.text)).join(" "),
    endS: Math.round(Math.max(seconds, inside.at(-1)!.endS) * 100) / 100,
  };
}

// A text's hook: its first sentence (or its first 160 characters).
export function hookFromText(text: string): string | null {
  // The first line: a list's heading ("Three hooks:") stays whole.
  const flat = squash(text.split(/\n/).find((line) => line.trim()) ?? "");
  if (!flat) return null;
  const sentence = /^.+?[.!?…](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

// Words a second over the time someone speaks, and cuts a minute over the
// whole video; "fast" past 2.8 words a second or 20 cuts a minute.
export function pacingOf(input: {
  segments: readonly TranscriptSegment[];
  durationS: number | null;
  cutsAtS: readonly number[];
}): { wordsPerSecond?: number; cutsPerMinute?: number; pace: Pace } | null {
  const spoken = input.segments.reduce((sum, s) => sum + Math.max(0, s.endS - s.startS), 0);
  const count = input.segments.reduce((sum, s) => sum + squash(s.text).split(" ").filter(Boolean).length, 0);
  const wordsPerSecond = spoken > 0 && count > 0 ? Math.round((count / spoken) * 10) / 10 : undefined;
  const cutsPerMinute =
    input.durationS && input.durationS > 0
      ? Math.round((input.cutsAtS.length / input.durationS) * 600) / 10
      : undefined;
  if (wordsPerSecond === undefined && cutsPerMinute === undefined) return null;
  let pace: Pace = "steady";
  if ((wordsPerSecond ?? 0) >= 2.8 || (cutsPerMinute ?? 0) >= 20) pace = "fast";
  else if (wordsPerSecond !== undefined ? wordsPerSecond < 2 : (cutsPerMinute ?? 0) <= 6) pace = "slow";
  return {
    ...(wordsPerSecond !== undefined ? { wordsPerSecond } : {}),
    ...(cutsPerMinute !== undefined ? { cutsPerMinute } : {}),
    pace,
  };
}

// 72.6 → "1:12"; 3723 → "1:02:03".
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// The most frequent meaningful words: tags when no model can write them.
export function keywordTags(text: string, count = 5): string[] {
  const seen = new Map<string, { n: number; first: number }>();
  words(text).forEach((word, i) => {
    if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) return;
    const entry = seen.get(word);
    if (entry) entry.n += 1;
    else seen.set(word, { n: 1, first: i });
  });
  return [...seen.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, count)
    .map(([word]) => word);
}

export interface VoiceSample {
  title: string;
  hook: string | null;
  tone: readonly string[];
  wordsPerSecond: number | null;
  // What was said or written, for the sentence length.
  text: string;
}

const one = (n: number) => String(Math.round(n * 10) / 10);

// "In my voice": a few lines about the user's own pieces (hooks they open
// with, tone, pace, sentence length), added to the prompts that write for
// them. Short on purpose: the browser edition's model reads 4,096 tokens in all.
export function styleProfile(samples: readonly VoiceSample[], maxChars = 600): string | null {
  if (samples.length === 0) return null;
  const parts = [`From ${samples.length} of your own piece${samples.length === 1 ? "" : "s"}.`];
  const hooks = samples
    .map((s) => s.hook?.trim())
    .filter((h): h is string => Boolean(h))
    .slice(0, 3)
    .map((h) => `"${h.length > 90 ? `${h.slice(0, 89)}…` : h}"`);
  if (hooks.length) parts.push(`Hooks you open with: ${hooks.join("; ")}.`);
  const tones = new Map<string, number>();
  for (const s of samples) for (const t of s.tone) tones.set(t.toLowerCase(), (tones.get(t.toLowerCase()) ?? 0) + 1);
  const topTones = [...tones.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([t]) => t);
  if (topTones.length) parts.push(`Tone: ${topTones.join(", ")}.`);
  const rates = samples.map((s) => s.wordsPerSecond).filter((r): r is number => r !== null && r > 0);
  if (rates.length) parts.push(`Pace: about ${one(rates.reduce((a, b) => a + b, 0) / rates.length)} words a second.`);
  const sentences = samples
    .flatMap((s) => squash(s.text).split(/(?<=[.!?…])\s+/))
    .filter((s) => s.split(" ").length > 1);
  if (sentences.length) {
    const average = sentences.reduce((sum, s) => sum + s.split(" ").length, 0) / sentences.length;
    parts.push(`Sentences: about ${Math.round(average)} words.`);
  }
  let profile = "";
  for (const part of parts) {
    const next = profile ? `${profile} ${part}` : part;
    if (next.length > maxChars) break;
    profile = next;
  }
  return profile;
}

// Common English and French words, left out of keyword search and tags.
const STOPWORDS = new Set(
  (
    "the a an and or but if of to in on at for with from by as is are was were be been being it its this that these those there here " +
    "you your yours we our they their them he she his her i me my mine not no so do does did have has had will would can could should " +
    "just than then too very also about into over out up down what which who whom when where why how all any each more most some such " +
    "only own same other one two get got make made like really thing things want need know think going gonna well yeah okay " +
    "le la les un une des du de et ou mais si au aux en dans sur pour par avec sans ce cet cette ces il elle ils elles on nous vous " +
    "je tu me te se mon ton son ma ta sa mes tes ses notre votre leur leurs est sont etait etre avoir fait faire plus moins tres pas " +
    "que qui quoi dont comme aussi alors donc car tout tous toute toutes bien encore deja ici voila"
  ).split(" "),
);
