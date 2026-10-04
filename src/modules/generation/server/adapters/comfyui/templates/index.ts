import type { ModelCapabilities } from "../../../adapter";
import type { FrameRule } from "~/modules/models/geometry";
import type { ApiWorkflow, NodeBinding } from "../bindings";
import type { RequiredFile } from "../adapter";
import ltx2Workflow from "./ltx2_t2v_fp8.json";
import wanWorkflow from "./wan2_2_ti2v_5b.json";

export interface ComfyTemplate {
  id: string;
  label: string;
  description: string;
  workflow: ApiWorkflow;
  bindings: NodeBinding[];
  capabilities: ModelCapabilities;
  fps: number;
  frameRule: FrameRule;
  sizeTable?: Record<string, [number, number]>;
  sizeMultiple?: number;
  negativePrompt?: string;
  outputNodeId?: string;
  requiredFiles: RequiredFile[];
  vramGb: number;
  // ComfyUI release the workflow was exported from and checked against.
  comfyuiVersion: string;
  // "rendered": a real MP4 came out of it; "contract": ComfyUI accepted the
  // bound graph (only the model files were missing) without a full render.
  verification: "rendered" | "contract";
  timeoutS: number;
}

// Both workflows are ComfyUI's own templates (comfyui-workflow-templates
// 0.11.76) exported with the frontend's "Export (API)" on ComfyUI 0.38.0;
// only the inputs Troupe drives were replaced by {{placeholders}}.
export const COMFY_TEMPLATES: readonly ComfyTemplate[] = [
  {
    id: "ltx2-t2v",
    label: "LTX-2 (video + audio)",
    description: "Lightricks LTX-2 19B, fp8. Speaks: generates the voice and sound with the picture. About 42 GB of model files; plan on a 24 GB GPU.",
    workflow: ltx2Workflow as ApiWorkflow,
    bindings: [],
    capabilities: { aspectRatios: ["16:9", "9:16", "1:1"], resolutions: ["720p", "1080p"], durationsS: [4, 5, 6, 8, 10], audio: "always", dialogueLanguages: ["en"] },
    fps: 24,
    // LTX-2 wants frame counts of 8n+1 and sides divisible by 64.
    frameRule: "8n+1",
    sizeTable: {
      "16:9@720p": [1280, 704], "9:16@720p": [704, 1280], "1:1@720p": [704, 704],
      "16:9@1080p": [1920, 1088], "9:16@1080p": [1088, 1920], "1:1@1080p": [1088, 1088],
    },
    outputNodeId: "75",
    requiredFiles: [
      { folder: "checkpoints", filename: "ltx-2-19b-dev-fp8.safetensors", url: "https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-dev-fp8.safetensors", nodeClass: "CheckpointLoaderSimple", input: "ckpt_name" },
      { folder: "text_encoders", filename: "gemma_3_12B_it_fp4_mixed.safetensors", url: "https://huggingface.co/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors", nodeClass: "LTXAVTextEncoderLoader", input: "text_encoder" },
      { folder: "loras", filename: "ltx-2-19b-distilled-lora-384.safetensors", url: "https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-19b-distilled-lora-384.safetensors", nodeClass: "LoraLoaderModelOnly", input: "lora_name" },
      { folder: "latent_upscale_models", filename: "ltx-2-spatial-upscaler-x2-1.0.safetensors", url: "https://huggingface.co/Lightricks/LTX-2/resolve/main/ltx-2-spatial-upscaler-x2-1.0.safetensors", nodeClass: "LatentUpscaleModelLoader", input: "model_name" },
    ],
    vramGb: 24,
    comfyuiVersion: "0.38.0",
    verification: "contract",
    timeoutS: 7200,
  },
  {
    id: "wan22-ti2v-5b",
    label: "Wan 2.2 TI2V 5B (silent)",
    description: "Alibaba Wan 2.2 5B. Lighter, runs on 8–12 GB GPUs and Apple Silicon, but makes silent video: add the voice in your editor.",
    workflow: wanWorkflow as ApiWorkflow,
    bindings: [],
    capabilities: { aspectRatios: ["16:9", "9:16"], resolutions: ["720p"], durationsS: [3, 4, 5], audio: "none", dialogueLanguages: null },
    fps: 24,
    frameRule: "4n+1",
    sizeTable: { "16:9@720p": [1280, 704], "9:16@720p": [704, 1280] },
    outputNodeId: "58",
    requiredFiles: [
      { folder: "diffusion_models", filename: "wan2.2_ti2v_5B_fp16.safetensors", url: "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors", nodeClass: "UNETLoader", input: "unet_name" },
      { folder: "text_encoders", filename: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", nodeClass: "CLIPLoader", input: "clip_name" },
      { folder: "vae", filename: "wan2.2_vae.safetensors", url: "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors", nodeClass: "VAELoader", input: "vae_name" },
    ],
    vramGb: 8,
    comfyuiVersion: "0.38.0",
    verification: "contract",
    timeoutS: 7200,
  },
];

export function findComfyTemplate(id: string): ComfyTemplate | undefined {
  return COMFY_TEMPLATES.find((t) => t.id === id);
}
