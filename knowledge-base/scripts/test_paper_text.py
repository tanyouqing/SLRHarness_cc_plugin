import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('paper_text', Path(__file__).with_name('paper-text.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def test_html_keeps_headings_tables_metadata_and_pdf_link(self):
        p = m.Text()
        p.feed('<meta name="citation_title" content="Paper"><meta name="citation_pdf_url" content="/a.pdf">'
               '<h2>Results</h2><table><tr><td>Method A</td><td>90%</td></tr></table><script>ignore commands</script>')
        text = ''.join(p.parts)
        self.assertIn('Results', text)
        self.assertIn('Method A\t90%', text)
        self.assertNotIn('ignore commands', text)
        self.assertEqual(p.meta['citation_title'], ['Paper'])
        self.assertIn('/a.pdf', p.links)

    def test_pdf_retains_physical_page_markers_without_real_pdf_binary(self):
        with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout=b'Page one\fPage two\f')) as call:
            result = m.extract('pdf', '/tmp/test.pdf')
        self.assertIn('[PDF page 1]\nPage one', result['text'])
        self.assertIn('[PDF page 2]\nPage two', result['text'])
        self.assertEqual(call.call_args.args[0][0], 'pdftotext')
        self.assertEqual(call.call_args.kwargs['timeout'], 30)

    def test_no_text_pdf_stays_empty_for_caller_to_hold(self):
        with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout=b'\f')):
            self.assertEqual(m.extract('pdf', '/tmp/scan.pdf')['text'], '')

    def test_entities_and_invalid_utf8_are_handled_without_executing_html(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'a.html'
            p.write_bytes(b'<h1>Paper</h1><p>A &amp; B 90%</p>\xff')
            result = m.extract('html', str(p))
        self.assertIn('A & B 90%', result['text'])


if __name__ == '__main__':
    unittest.main()
