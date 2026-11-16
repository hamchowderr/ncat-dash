/** Sends a file to a presigned link, reporting progress. Resolves when the bucket accepts it. */
export function putWithProgress(url: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("refused"));
    request.onerror = () => reject(new Error("network"));
    request.send(file);
  });
}
