import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('import-search-mcp.py')
spec = importlib.util.spec_from_file_location('import_search_mcp', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    def test_selection_and_project_override(self):
        data = {'mcpServers': {'arxiv': {'command': 'uvx', 'args': ['fixture'], 'unused': True}},
                'projects': {'/workspace': {'mcpServers': {'arxiv': {'type': 'http', 'url': 'https://example.org/mcp'}}}}}
        self.assertEqual(module.select(data, ['arxiv'])['mcpServers']['arxiv'], {'type': 'stdio', 'command': 'uvx', 'args': ['fixture']})
        self.assertEqual(module.select(data, ['arxiv'], '/workspace')['mcpServers']['arxiv']['type'], 'http')
        with self.assertRaises(ValueError):
            module.select(data, ['survey-kb'])
        with self.assertRaises(ValueError):
            module.select(data, ['missing'])

    def test_private_copy_without_execution_or_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'claude.json', Path(directory)/'search-mcp.json'
            content = json.dumps({'mcpServers': {'arxiv': {'command': 'does-not-exist', 'env': {'API_KEY': 'private-fixture-secret'}}}})
            source.write_text(content, encoding='utf-8')
            command = [sys.executable, str(SCRIPT), '--source', str(source), '--output', str(target), '--servers', 'arxiv']
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertNotIn('private-fixture-secret', first.stdout + first.stderr)
            self.assertEqual(json.loads(target.read_text())['mcpServers']['arxiv']['env']['API_KEY'], 'private-fixture-secret')
            self.assertEqual(source.read_text(), content)
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 1)
            self.assertEqual(subprocess.run(command+['--replace'], capture_output=True).returncode, 0)

    def test_invalid_json_does_not_echo_private_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'bad.json'
            source.write_text('private-fixture-secret', encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), '--source', str(source), '--output', str(Path(directory)/'out.json')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn('private-fixture-secret', result.stdout+result.stderr)


if __name__ == '__main__':
    unittest.main()
