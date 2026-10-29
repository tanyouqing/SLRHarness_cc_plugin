"""Copy selected Claude MCP definitions into a private KB config, without running servers."""
import argparse
import json
import os
from pathlib import Path


def select(data, names, project=None):
    servers = dict(data.get('mcpServers', {}))
    if project:
        servers.update(data.get('projects', {}).get(project, {}).get('mcpServers', {}))
    result = {}
    for name in names:
        if name == 'survey-kb':
            raise ValueError('survey-kb cannot be imported as a search server')
        if name not in servers:
            raise ValueError(f'MCP service not found: {name}')
        source = servers[name]
        allowed = ('type', 'command', 'args', 'env', 'url', 'headers', 'cwd', 'disabled', 'allowedTools')
        result[name] = {k: source[k] for k in allowed if k in source}
        result[name].setdefault('type', 'stdio' if source.get('command') else 'http')
        if result[name]['type'] not in ('stdio', 'http', 'sse'):
            raise ValueError(f'Unsupported MCP transport: {name}')
        if not result[name].get('command' if result[name]['type'] == 'stdio' else 'url'):
            raise ValueError(f'Incomplete MCP definition: {name}')
    return {'mcpServers': result}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--project')
    p.add_argument('--servers', nargs='+', default=['arxiv', 'tavily', 'scholar'])
    p.add_argument('--replace', action='store_true')
    args = p.parse_args()
    try:
        data = json.loads(Path(args.source).read_text(encoding='utf-8'))
        config = select(data, args.servers, args.project)
        output = Path(args.output)
        if output.resolve() == Path(args.source).resolve():
            raise ValueError('source and output must be different files')
        if output.is_symlink():
            raise ValueError('refusing symlink output')
        if output.exists() and not args.replace:
            raise ValueError('output exists; use --replace to explicitly overwrite it')
        output.parent.mkdir(parents=True, exist_ok=True)
        temp = output.with_name(output.name + '.new-' + str(os.getpid()))
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, output)
        print(json.dumps({'saved': str(output), 'services': [{'name': n, 'type': s['type']} for n, s in config['mcpServers'].items()],
                          'note': 'No service was started. Set file ownership for the container user and verify container commands/paths.'}))
    except ValueError as e:
        # JSON decoding errors may embed private content; report only an expected message.
        print(json.dumps({'error': 'invalid source JSON' if isinstance(e, json.JSONDecodeError) else str(e)}))
        return 1
    except Exception:
        print(json.dumps({'error': 'cannot prepare MCP config; check source/output permissions'}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
