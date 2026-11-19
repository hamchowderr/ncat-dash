import { audioConcatenate } from "./audio/concatenate";
import { codeExecutePython } from "./code/execute-python";
import { ffmpegCompose } from "./ffmpeg/compose";
import { imageScreenshotWebpage } from "./image/screenshot-webpage";
import { imageToVideo } from "./image/to-video";
import { mediaConvert } from "./media/convert";
import { mediaDownload } from "./media/download";
import { mediaGenerateAss } from "./media/generate-ass";
import { mediaLook } from "./media/look";
import { mediaMetadata } from "./media/metadata";
import { mediaSilenceDetect } from "./media/silence-detect";
import { mediaToMp3 } from "./media/to-mp3";
import { mediaTranscribe } from "./media/transcribe";
import { storageUploadGcp } from "./storage/upload-gcp";
import { storageUploadS3 } from "./storage/upload-s3";
import { videoCaption } from "./video/caption";
import { videoConcatenate } from "./video/concatenate";
import { videoCut } from "./video/cut";
import { videoReframe } from "./video/reframe";
import { videoSplit } from "./video/split";
import { videoThumbnail } from "./video/thumbnail";
import { videoTrim } from "./video/trim";

export const steps = [
  audioConcatenate,
  codeExecutePython,
  ffmpegCompose,
  imageScreenshotWebpage,
  imageToVideo,
  mediaConvert,
  mediaDownload,
  mediaGenerateAss,
  mediaLook,
  mediaMetadata,
  mediaSilenceDetect,
  mediaToMp3,
  mediaTranscribe,
  storageUploadGcp,
  storageUploadS3,
  videoCaption,
  videoConcatenate,
  videoCut,
  videoReframe,
  videoSplit,
  videoThumbnail,
  videoTrim,
] as const;

export {
  audioConcatenate,
  codeExecutePython,
  ffmpegCompose,
  imageScreenshotWebpage,
  imageToVideo,
  mediaConvert,
  mediaDownload,
  mediaGenerateAss,
  mediaLook,
  mediaMetadata,
  mediaSilenceDetect,
  mediaToMp3,
  mediaTranscribe,
  storageUploadGcp,
  storageUploadS3,
  videoCaption,
  videoConcatenate,
  videoCut,
  videoReframe,
  videoSplit,
  videoThumbnail,
  videoTrim,
};
