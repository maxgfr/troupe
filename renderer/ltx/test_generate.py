"""Tests for generate.py's helpers that need no model weights.

    uv run --project renderer/ltx python -m unittest discover renderer/ltx

They need the mode's Python environment (PyTorch), so they are not part of
`pnpm test`.
"""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import torch

import generate


def vae(**patch):
    # AutoencoderKLLTXVideo's tiling attributes, as enable_tiling() leaves them.
    return SimpleNamespace(**{
        "spatial_compression_ratio": 32,
        "temporal_compression_ratio": 8,
        "use_tiling": True,
        "use_framewise_decoding": True,
        "tile_sample_min_height": 512,
        "tile_sample_min_width": 512,
        "tile_sample_min_num_frames": 16,
        "tile_sample_stride_height": 448,
        "tile_sample_stride_width": 448,
        "tile_sample_stride_num_frames": 8,
        **patch,
    })


class PromptCache(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "prompts" / "key.pt"

    def tearDown(self):
        self.dir.cleanup()

    def test_saves_atomically_and_loads_back(self):
        prompt = {"prompt_embeds": torch.ones(1, 4, 8)}
        generate.save_cached(self.file, prompt)
        self.assertTrue(torch.equal(generate.load_cached(self.file)["prompt_embeds"], prompt["prompt_embeds"]))
        # No temporary file is left next to it.
        self.assertEqual([p.name for p in self.file.parent.iterdir()], ["key.pt"])

    def test_a_missing_file_is_a_miss(self):
        self.assertIsNone(generate.load_cached(self.file))

    def test_a_file_that_does_not_load_is_a_miss_and_is_deleted(self):
        self.file.parent.mkdir(parents=True)
        self.file.write_bytes(b"half a file")
        self.assertIsNone(generate.load_cached(self.file))
        self.assertFalse(self.file.exists())


class DecodeCalls(unittest.TestCase):
    def test_counts_tiles_across_time_and_across_the_frame(self):
        # 121 frames at 480x832: 16 latent frames, 26x15 latent pixels.
        self.assertEqual(generate.decode_calls(vae(), 16, 26, 15), 16 * 2 * 2)

    def test_counts_one_call_without_tiling(self):
        self.assertEqual(generate.decode_calls(vae(use_tiling=False, use_framewise_decoding=False), 16, 26, 15), 1)

    def test_follows_longer_chunks(self):
        self.assertEqual(generate.decode_calls(vae(tile_sample_min_num_frames=32, tile_sample_stride_num_frames=24), 16, 26, 15), 6 * 2 * 2)


if __name__ == "__main__":
    unittest.main()
