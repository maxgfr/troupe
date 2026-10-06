import type { ClaimedUpload } from "~/modules/library";

// Uploads the page has stored and not yet recorded, by item id: the router
// runs in this same page, so a plain map hands them over from the upload
// (site/src/library/uploader.tsx) to the analysis (./backend.ts). Its own
// module, so the shell's upload button does not load the analysis code.
export const pendingUploads = new Map<string, ClaimedUpload>();
