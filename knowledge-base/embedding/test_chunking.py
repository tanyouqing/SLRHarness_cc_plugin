import unittest
from chunking import windows, prepare_chunks


class FakeTokenizer:
    """One character per token: deterministic tests without downloading a model."""
    def encode(self, text, add_special_tokens=False):
        return list(text)

    def decode(self, tokens, skip_special_tokens=True):
        return "".join(tokens)

    def __call__(self, text, **kwargs):
        return {"offset_mapping": [(i, i + 1) for i in range(len(text))]}


class ChunkTests(unittest.TestCase):
    def test_minimal_experience(self):
        payload = {"strategy": "check metrics", "executionSummary": "observed"}
        chunks = prepare_chunks("experience", payload, FakeTokenizer(), 160, 16)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["text"], "check metrics\n\nobserved")

    def test_long_minimal_experience_preserves_strategy_offsets(self):
        strategy = "核对数据集和指标 " * 100
        chunks = prepare_chunks("experience", {"strategy": strategy, "executionSummary": "observed"}, FakeTokenizer(), 160, 16)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(c["text"]) < 160 for c in chunks))
        self.assertTrue(all(c["location"]["field"] == "strategy" for c in chunks))
        self.assertEqual(chunks[-1]["location"]["end"], len(strategy))
        for c in chunks:
            loc = c["location"]
            self.assertIn(strategy[loc["start"]:loc["end"]], c["text"])

    def test_long_text_coverage_and_bound(self):
        text = "实验结果 ABC " * 100
        chunks = windows(text, FakeTokenizer(), 128, 16, "title")
        self.assertTrue(all(len(c["text"]) < 128 for c in chunks))
        self.assertEqual(chunks[0]["start"], 0)
        self.assertEqual(chunks[-1]["end"], len(text))
        self.assertTrue(all(b["start"] <= a["end"] for a, b in zip(chunks, chunks[1:])))

    def test_paper_sections_and_offsets(self):
        note = "# One\n" + "body " * 60 + "\n\n# Two\n结论"
        chunks = prepare_chunks("paper", {"metadata": {"title": "Fixture"}, "note": note}, FakeTokenizer(), 160, 16)
        self.assertTrue(any(c["location"]["heading"] == "# Two" for c in chunks))
        for c in chunks:
            loc = c["location"]
            self.assertIn(note[loc["start"]:loc["end"]], c["text"])

    def test_long_applicability_not_discarded(self):
        payload = {"task": "task", "applicability": "condition " * 100, "strategy": "action " * 100, "executionSummary": "observed"}
        chunks = prepare_chunks("experience", payload, FakeTokenizer(), 160, 16)
        conditions = [c for c in chunks if c["location"]["field"] == "applicability"]
        self.assertTrue(conditions)
        self.assertEqual(conditions[-1]["location"]["end"], len(payload["applicability"]))


if __name__ == "__main__":
    unittest.main()
