import type { LibraryUploader } from "~/app/_components/edition";

// The self-hosted studio's uploads: the file as the request body of
// /api/library/upload (with the progress the browser reports), answered with
// the new item. XMLHttpRequest, because fetch cannot report upload progress.
export const serverUploader: LibraryUploader = {
  upload(file, { workspaceId, mine, onProgress }) {
    return new Promise((resolve, reject) => {
      const query = new URLSearchParams({ name: file.name, workspaceId, mine: mine ? "1" : "0" });
      const request = new XMLHttpRequest();
      request.open("POST", `/api/library/upload?${query}`);
      request.setRequestHeader("content-type", "application/octet-stream");
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      request.onload = () => {
        let body: { item?: { id: string }; error?: string } = {};
        try {
          body = JSON.parse(request.responseText);
        } catch {}
        if (request.status === 200 && body.item) resolve({ id: body.item.id });
        else reject(new Error(body.error ?? `The upload failed (HTTP ${request.status}).`));
      };
      request.onerror = () => reject(new Error("The upload was cut off. Check the connection to the studio and try again."));
      request.send(file);
    });
  },
};
