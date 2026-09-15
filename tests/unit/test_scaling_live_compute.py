"""Tests for the pure-Python heuristics in scaling_live_compute.py
(batch-size argv parsing, GPU short-name normalization)."""

import pytest

from dashboard.server.scaling_live_compute import extract_batch_size, normalize_gpu_short


class TestExtractBatchSize:
    def test_batch_dash_flag(self):
        command = ["voir", "-m", "bench", "--precision", "fp32", "--batch-size", "72"]
        assert extract_batch_size(command) == 72

    def test_batch_underscore_flag(self):
        command = ["python", "main.py", "--batch_size", "128"]
        assert extract_batch_size(command) == 128

    def test_equals_form(self):
        command = ["python", "main.py", "--batch-size=64"]
        assert extract_batch_size(command) == 64

    def test_more_specific_flag_preferred(self):
        # per_device_train_batch_size is checked before the generic form,
        # and both being present shouldn't happen in practice, but the more
        # specific one should win if it does.
        command = ["python", "main.py", "--per_device_train_batch_size", "8", "--batch-size", "64"]
        assert extract_batch_size(command) == 8

    def test_no_batch_flag_returns_none(self):
        command = ["python", "main.py", "--model", "DimeNet", "--num-samples", "100000"]
        assert extract_batch_size(command) is None

    def test_none_command(self):
        assert extract_batch_size(None) is None

    def test_empty_command(self):
        assert extract_batch_size([]) is None

    def test_non_numeric_value_returns_none(self):
        command = ["python", "main.py", "--batch-size", "auto"]
        assert extract_batch_size(command) is None

    def test_flag_at_end_with_no_value(self):
        command = ["python", "main.py", "--batch-size"]
        assert extract_batch_size(command) is None

    def test_non_string_argv_elements_are_skipped(self):
        # defensive: command lists should be strings, but don't crash on stray types
        command = [123, "--batch-size", "16"]
        assert extract_batch_size(command) == 16

    def test_torchtune_bare_key_value_form(self):
        # torchtune's CLI (llm-lora-single/-ddp-gpus/-mp-gpus, llm-full-mp-gpus)
        # takes bare `key=value` overrides with no leading dashes.
        command = [
            "tune", "run", "--", "bench/lora_finetune_single_device.py",
            "epochs=1", "batch_size=8", "gradient_accumulation_steps=8",
        ]
        assert extract_batch_size(command) == 8

    def test_bare_batch_size_non_numeric_returns_none(self):
        command = ["tune", "run", "batch_size=auto"]
        assert extract_batch_size(command) is None


class TestNormalizeGpuShort:
    def test_nvidia_h100(self):
        assert normalize_gpu_short("NVIDIA H100 80GB HBM3") == "H100"

    def test_amd_instinct_mi355(self):
        assert normalize_gpu_short("AMD Instinct MI355 OAM") == "MI355"

    def test_amd_instinct_mi325x(self):
        assert normalize_gpu_short("AMD Instinct MI325X") == "MI325X"

    def test_l40s(self):
        assert normalize_gpu_short("NVIDIA L40S") == "L40S"

    def test_none_input(self):
        assert normalize_gpu_short(None) is None

    def test_empty_string(self):
        assert normalize_gpu_short("") is None

    def test_unknown_model_falls_back_to_first_token(self):
        # No known code matches and no recognized noise words to strip —
        # falls back to the first token rather than crashing or returning
        # the whole string.
        assert normalize_gpu_short("SomeFutureVendor XYZ9000 Accelerator") == "SomeFutureVendor"

    def test_unknown_model_strips_known_noise_words_first(self):
        # Known vendor/marketing words are stripped before falling back to
        # the first remaining token.
        assert normalize_gpu_short("NVIDIA XYZ9000 Accelerator") == "XYZ9000"
