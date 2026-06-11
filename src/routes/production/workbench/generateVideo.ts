import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
const router = express.Router();
const VIDEO_REFERENCE_IMAGE_MAX_BYTES = 512 * 1024;
const VIDEO_REFERENCE_IMAGE_MAX_EDGE = 1280;

type Type = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface UploadItem {
  fileType: "image" | "video" | "audio";
  type: Type;
  sources?: "assets" | "storyboard";
  id?: number;
  src?: string;
  label?: string;
  prompt?: string;
}

interface ResolvedReference {
  path?: string;
  sources?: string;
}

function normalizeVideoMode(mode: string, modeData: any[]): VideoMode[] {
  return modeData.length > 0 ? (modeData as VideoMode[]) : [mode as VideoMode];
}

async function resolveReference(item: Pick<UploadItem, "id" | "sources">): Promise<ResolvedReference | null> {
  if (item.sources === "storyboard") {
    const filePath = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
    return { path: filePath?.filePath ?? undefined, sources: "storyBoard" };
  }
  if (item.sources === "assets") {
    const filePath = await u
      .db("o_assets")
      .where("o_assets.id", item.id)
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .select("o_image.filePath", "o_image.type")
      .first();
    return { path: filePath?.filePath, sources: filePath?.type ?? undefined };
  }
  return null;
}

async function buildReferenceList(images: Array<ResolvedReference | null>): Promise<ReferenceList[]> {
  const refs = await Promise.all(
    images.map(async (item) => {
      if (!item?.path) return null;
      return {
        base64: await u.oss.getImageBase64(item.path, {
          maxBytes: VIDEO_REFERENCE_IMAGE_MAX_BYTES,
          maxEdge: VIDEO_REFERENCE_IMAGE_MAX_EDGE,
        }),
        type: item.sources == "audio" ? "audio" : "image",
      } as ReferenceList;
    }),
  );
  return refs.filter((item): item is ReferenceList => Boolean(item));
}

async function runVideoGenerationTask(input: {
  projectId: number;
  scriptId: number;
  videoId: number;
  videoPath: string;
  prompt: string;
  images: Array<ResolvedReference | null>;
  model: string;
  duration: number;
  resolution: string;
  audio?: boolean;
  mode: string;
  modeData: VideoMode[];
  aspectRatio: "16:9" | "9:16";
}) {
  const { projectId, scriptId, videoId, videoPath, prompt, images, model, duration, resolution, audio, mode, modeData, aspectRatio } = input;
  try {
    const referenceList = await buildReferenceList(images);
    const relatedObjects = {
      projectId,
      videoId,
      scriptId,
      type: "视频",
    };
    const aiVideo = u.Ai.Video(model as `${string}:${string}`);
    await aiVideo.run(
      {
        prompt,
        referenceList,
        mode: normalizeVideoMode(mode, modeData),
        duration,
        aspectRatio,
        resolution,
        audio,
      },
      {
        projectId,
        taskClass: "视频生成",
        describe: "根据提示词生成视频",
        relatedObjects: JSON.stringify(relatedObjects),
      },
    );
    await aiVideo.save(videoPath);
    await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
  } catch (error: any) {
    await u
      .db("o_video")
      .where("id", videoId)
      .update({
        state: "生成失败",
        errorReason: u.error(error).message,
      });
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    uploadData: z.array(
      z.object({
        id: z.number(),
        sources: z.string(),
      }),
    ),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    audio: z.boolean().optional(),
    trackId: z.number(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId } = req.body;
    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }
    //获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const videoPath = `/${projectId}/video/${uuidv4()}.mp4`; //视频保存路径
    //查询出图片数据
    const images = await Promise.all(
      uploadData.map(async (item: UploadItem) => {
        return resolveReference(item);
      }),
    );
    //新增
    const [videoId] = await u.db("o_video").insert({
      filePath: videoPath,
      time: Date.now(),
      state: "生成中",
      scriptId,
      projectId,
      videoTrackId: trackId,
    });
    res.status(200).send(success(videoId));
    setTimeout(() => {
      void runVideoGenerationTask({
        projectId,
        scriptId,
        videoId,
        videoPath,
        prompt,
        images,
        model,
        duration,
        resolution,
        audio,
        mode,
        modeData: modeData as VideoMode[],
        aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
      });
    }, 0);
  },
);
