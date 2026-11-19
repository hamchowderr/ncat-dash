/**
 * Sends a file (or one part of it) to a presigned link, reporting progress. Resolves with
 * the ETag the bucket answered with (null if the bucket's CORS rule hides it) once the
 * bucket accepts it.
 */
export function putWithProgress(
  url: string,
  file: Blob,
  onProgress: (percent: number) => void,
): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve(request.getResponseHeader("ETag"))
        : reject(new Error("refused"));
    request.onerror = () => reject(new Error("network"));
    request.send(file);
  });
}
