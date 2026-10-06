import { createClient } from "@supabase/supabase-js";

import { downloadFileName } from "./store";

export function supabaseStorage() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url && !key) return null;
  if (!url || !key) throw new Error("Configure both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
}
const bucketName = () => process.env.SUPABASE_STORAGE_BUCKET ?? "troupe-media";

export async function uploadToSupabase(storagePath: string, bytes: Uint8Array) {
  const storage = supabaseStorage();
  if (!storage) return false;
  const name = bucketName();
  const current = await storage.getBucket(name);
  if (current.error) {
    await storage.createBucket(name, {
      public: false,
      allowedMimeTypes: ["video/mp4"],
      fileSizeLimit: 50 * 1024 * 1024,
    });
  }
  const verified = await storage.getBucket(name);
  if (verified.error || !verified.data || verified.data.public)
    throw new Error("A private Supabase video bucket is required.");
  const result = await storage.from(name).upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
  if (result.error) throw new Error("Could not store the video in Supabase.");
  return true;
}

// `download`: the media URL's download query (null to play inline).
export async function supabaseDownloadUrl(storagePath: string, download: string | null) {
  const storage = supabaseStorage();
  if (!storage) throw new Error("Supabase storage is not configured.");
  const name = downloadFileName(download);
  const result = await storage.from(bucketName()).createSignedUrl(storagePath, 60, name ? { download: name } : {});
  if (result.error || !result.data) throw new Error("Could not open the stored video.");
  return result.data.signedUrl;
}

export async function removeFromSupabase(storagePaths: string[]) {
  const storage = supabaseStorage();
  if (!storage || storagePaths.length === 0) return;
  const result = await storage.from(bucketName()).remove(storagePaths);
  if (result.error) throw new Error("Could not delete stored videos from Supabase.");
}
