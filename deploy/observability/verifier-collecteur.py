#!/usr/bin/env python3
"""Vérifie localement la configuration du collecteur (collector-values.yaml).

Rend le chart avec helm, valide la configuration obtenue avec otelcol-contrib,
puis lance le collecteur sur la boucle locale, lui envoie des traces factices
et contrôle l'authentification, le filtrage et l'export vers un faux Langfuse.
Toutes les valeurs sont factices ; rien ne sort de la machine, hormis le
téléchargement du chart quand --chart n'est pas donné.

Usage :
  python3 deploy/observability/verifier-collecteur.py --otelcol <otelcol-contrib> [--chart <chart>]

Le binaire otelcol-contrib doit avoir la version de `image.tag`. Ports locaux
utilisés : 13133, 14318, 18080 et 18888.
"""
import argparse
import base64
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VALUES = os.path.join(HERE, "collector-values.yaml")
CHART_REPO = "https://open-telemetry.github.io/opentelemetry-helm-charts"
CHART_VERSION = "0.175.1"
TOKEN = "fake-qrg-token-0123456789abcdef"
AUTH = base64.b64encode(b"pk-lf-fake:sk-lf-fake").decode()
SECRET = "SECRET-CONTENT"


def render(chart, work):
    """Rend le chart et renvoie le contenu de la clé `relay` de la ConfigMap."""
    env = dict(os.environ)
    # Configuration helm isolée : le rendu ne dépend pas des dépôts locaux.
    for var in ("HELM_CONFIG_HOME", "HELM_CACHE_HOME", "HELM_DATA_HOME"):
        env[var] = os.path.join(work, var.lower())
    cmd = ["helm", "template", "qrg-otel-collector"]
    cmd += [chart] if chart else ["opentelemetry-collector", "--repo", CHART_REPO, "--version", CHART_VERSION]
    cmd += ["-n", "langfuse", "-f", VALUES]
    out = subprocess.run(cmd, env=env, check=True, capture_output=True, text=True).stdout
    for doc in out.split("\n---\n"):
        if re.search(r"^kind: ConfigMap", doc, re.M):
            body = re.search(r"^  relay: \|\n((?:    .*\n?|\n)*)", doc, re.M).group(1)
            return "\n".join(line[4:] for line in body.splitlines()) + "\n"
    raise SystemExit("ConfigMap du collecteur introuvable dans le rendu")


def list_block(relay, key):
    """Renvoie les éléments de la liste YAML qui suit `key:` dans relay."""
    lines = relay.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == f"{key}:":
            items = []
            for nxt in lines[i + 1:]:
                m = re.match(r"^\s*- (\S+)$", nxt)
                if not m:
                    break
                items.append(m.group(1))
            return set(items)
    raise SystemExit(f"liste {key} introuvable dans la configuration")


class Capture(http.server.BaseHTTPRequestHandler):
    """Faux Langfuse : enregistre chemin, en-têtes et taille, répond 200."""

    received = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        headers = {k.lower(): v for k, v in self.headers.items()}
        Capture.received.append((self.path, headers, len(body)))
        self.send_response(200)
        self.send_header("Content-Type", "application/x-protobuf")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


def s(value):
    return {"stringValue": value}


def i(value):
    return {"intValue": str(value)}


def attrs(mapping):
    return [{"key": k, "value": v} for k, v in mapping.items()]


def payload():
    """Trace factice : un span d'agent, un appel LLM et un appel d'outil, avec
    du contenu marqué SECRET partout où il ne doit pas survivre."""
    trace = "5b8efff798038103d269b633813fc60c"
    common = {"dsh.session.id": s("sess-1"), "dsh.session.cwd": s(f"/Users/someone/{SECRET}"), "user.id": s(SECRET)}
    agent = {
        "traceId": trace, "spanId": "aaa19b7ec3c1b174", "name": "invoke_agent qrg", "kind": 1,
        "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000003000000000",
        "attributes": attrs({**common, "gen_ai.operation.name": s("invoke_agent"), "gen_ai.agent.name": s("qrg"),
                             "gen_ai.usage.input_tokens": i(100), "dsh.session.delegation_depth": i(0),
                             "dsh.turn.end_reason": s("done")}),
        "status": {"code": 1},
    }
    chat = {
        "traceId": trace, "spanId": "eee19b7ec3c1b174", "parentSpanId": "aaa19b7ec3c1b174",
        "name": "chat linagora-model", "kind": 3,
        "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000001000000000",
        "attributes": attrs({**common, "gen_ai.operation.name": s("chat"), "gen_ai.request.model": s("linagora-model"),
                             "gen_ai.usage.input_tokens": i(100), "gen_ai.usage.output_tokens": i(20),
                             "gen_ai.response.finish_reasons": {"arrayValue": {"values": [s("stop")]}},
                             "gen_ai.input.messages": s(json.dumps([{"role": "user", "content": SECRET}])),
                             "gen_ai.output.messages": s(json.dumps([{"role": "assistant", "content": SECRET}])),
                             "gen_ai.system_instructions": s(SECRET), "langfuse.observation.input": s(SECRET)}),
        "events": [
            {"timeUnixNano": "1700000000500000000", "name": "gen_ai.client.inference.operation.details",
             "attributes": attrs({"gen_ai.input.messages": s(SECRET)})},
            {"timeUnixNano": "1700000000600000000", "name": "exception",
             "attributes": attrs({"exception.message": s(SECRET), "exception.stacktrace": s(SECRET)})},
        ],
        "links": [{"traceId": "5b8efff798038103d269b633813fc60d", "spanId": "eee19b7ec3c1b175",
                   "attributes": attrs({"link.note": s(SECRET)})}],
        "status": {"code": 2, "message": f"failed reading /Users/someone/{SECRET}"},
    }
    tool = {
        "traceId": trace, "spanId": "bbb19b7ec3c1b174", "parentSpanId": "aaa19b7ec3c1b174",
        "name": "execute_tool read_file", "kind": 1,
        "startTimeUnixNano": "1700000001000000000", "endTimeUnixNano": "1700000002000000000",
        "attributes": attrs({**common, "gen_ai.operation.name": s("execute_tool"), "gen_ai.tool.name": s("read_file"),
                             "gen_ai.tool.call.id": s("call_sk-abcdefghijklmnopqrstuvwxyz0123"),
                             "gen_ai.tool.call.arguments": s(json.dumps({"path": SECRET})),
                             "gen_ai.tool.call.result": s(SECRET), "error.type": s("TOOL_ERROR")}),
        "status": {"code": 2, "message": SECRET},
    }
    resource = attrs({"service.name": s("qrg"), "service.version": s("0.0.0"), "host.name": s(SECRET),
                      "process.command_line": s(f"node dsh --key {SECRET}"), "process.owner": s(SECRET)})
    scope = {"name": "qrg-otel", "version": "0.0.0", "attributes": attrs({"scope.note": s(SECRET)})}
    return {"resourceSpans": [{"resource": {"attributes": resource},
                               "scopeSpans": [{"scope": scope, "spans": [agent, chat, tool]}]}]}


def post(path, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"http://127.0.0.1:14318{path}", data=json.dumps(payload()).encode(),
                                 headers=headers, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=5).status
    except urllib.error.HTTPError as err:
        return err.code


def wait_healthy():
    for _ in range(100):
        try:
            if urllib.request.urlopen("http://127.0.0.1:13133/", timeout=1).status == 200:
                return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--otelcol", required=True, help="binaire otelcol-contrib")
    parser.add_argument("--chart", help="dossier ou archive du chart (sinon téléchargé)")
    args = parser.parse_args()

    tag = re.search(r'^  tag: "([^"]+)"', open(VALUES).read(), re.M).group(1)
    version = subprocess.run([args.otelcol, "--version"], check=True, capture_output=True, text=True).stdout.split()[-1]
    if version != tag:
        raise SystemExit(f"otelcol-contrib {version} au lieu de {tag} (image.tag)")

    work = tempfile.mkdtemp(prefix="verifier-collecteur-")
    passed = False
    try:
        relay = render(args.chart, work)
        allowed = list_block(relay, "allowed_keys")
        keep = set(re.findall(r'"([^"]+)"', re.search(r"keep_keys\(resource\.attributes, \[([^\]]*)\]\)", relay, re.S).group(1)))
        out = os.path.join(work, "out.jsonl")
        # Même configuration que le pod, sur la boucle locale ; seuls le port
        # de réception, la cible de l'export et la métrique interne changent,
        # et une copie JSON des traces traitées est ajoutée pour les contrôles.
        open(os.path.join(work, "relay.yaml"), "w").write(relay.replace("${env:MY_POD_IP}:4318", "127.0.0.1:14318"))
        open(os.path.join(work, "overlay.yaml"), "w").write(f"""\
exporters:
  otlp_http/langfuse:
    endpoint: http://127.0.0.1:18080/api/public/otel
  file/out:
    path: {out}
service:
  telemetry:
    metrics:
      readers:
        - pull:
            exporter:
              prometheus:
                host: 127.0.0.1
                port: 18888
  pipelines:
    traces:
      exporters: [otlp_http/langfuse, file/out]
""")
        env = {"PATH": os.environ.get("PATH", ""), "MY_POD_IP": "127.0.0.1", "QRG_OTLP_TOKEN": TOKEN, "LANGFUSE_AUTH": AUTH}
        configs = [f"--config={os.path.join(work, 'relay.yaml')}"]
        subprocess.run([args.otelcol, "validate", *configs], env=env, check=True, cwd=work)

        server = http.server.HTTPServer(("127.0.0.1", 18080), Capture)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        log_path = os.path.join(work, "collector.log")
        with open(log_path, "w") as log:
            proc = subprocess.Popen([args.otelcol, *configs, f"--config={os.path.join(work, 'overlay.yaml')}"],
                                    env=env, stdout=log, stderr=log, cwd=work)
            try:
                if not wait_healthy():
                    raise SystemExit("le collecteur n'a pas démarré :\n" + open(log_path).read())
                status = {"sans jeton": post("/v1/traces"), "jeton faux": post("/v1/traces", "faux"),
                          "bon jeton": post("/v1/traces", TOKEN)}
                time.sleep(3)
            finally:
                proc.terminate()
                proc.wait(timeout=20)
                server.shutdown()

        text = open(out).read() if os.path.exists(out) else ""
        spans, resource_keys, scope_keys, span_keys = [], set(), set(), set()
        for line in filter(str.strip, text.splitlines()):
            for rs in json.loads(line).get("resourceSpans", []):
                resource_keys |= {a["key"] for a in rs.get("resource", {}).get("attributes", [])}
                for ss in rs.get("scopeSpans", []):
                    scope_keys |= {a["key"] for a in ss.get("scope", {}).get("attributes", [])}
                    for span in ss.get("spans", []):
                        spans.append(span)
                        span_keys |= {a["key"] for a in span.get("attributes", [])}
        exports = Capture.received
        checks = {
            "401 sans jeton": status["sans jeton"] == 401,
            "401 avec un jeton faux": status["jeton faux"] == 401,
            "200 avec le jeton": status["bon jeton"] == 200,
            "3 spans exportés": len(spans) == 3,
            "aucun contenu SECRET exporté": SECRET not in text,
            "aucun événement de span": all(not sp.get("events") for sp in spans),
            "aucun lien de span": all(not sp.get("links") for sp in spans),
            "attributs de ressource dans la liste fixe": resource_keys - {"redaction.redacted.count"} <= keep,
            "aucun attribut de portée": not scope_keys,
            "messages de statut vides": all(not sp.get("status", {}).get("message") for sp in spans),
            "codes de statut conservés": sorted(sp.get("status", {}).get("code", 0) for sp in spans) == [1, 2, 2],
            "attributs de span dans la liste autorisée": all(k in allowed or k.startswith("redaction.") for k in span_keys),
            "usage conservé": "gen_ai.usage.input_tokens" in span_keys and "gen_ai.operation.name" in span_keys,
            "valeur en forme de clé masquée": "sk-abcdefghijklmnopqrstuvwxyz0123" not in text,
            "export sur /api/public/otel/v1/traces": any(e[0] == "/api/public/otel/v1/traces" for e in exports),
            "export avec Authorization Basic": any(e[1].get("authorization") == f"Basic {AUTH}" for e in exports),
            "export avec x-langfuse-ingestion-version: 4": any(e[1].get("x-langfuse-ingestion-version") == "4" for e in exports),
        }
        for name, ok in checks.items():
            print(("OK     " if ok else "ÉCHEC  ") + name)
        passed = all(checks.values())
        if passed:
            print(f"{len(checks)} contrôles réussis (otelcol-contrib {version}).")
    finally:
        # Le dossier de travail reste en place après un échec, pour le journal.
        if passed:
            shutil.rmtree(work, ignore_errors=True)
        else:
            print("dossier de travail conservé :", work)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
