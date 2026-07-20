#!/usr/bin/env python3
"""重排序（cross-encoder）：对 (query, candidates) 打分，用于 RAG 召回后精排。

用法:
  python3 rerank.py --infile in.json --outfile out.json
  in.json:  {"query": "...", "candidates": ["片段1", "片段2", ...]}
  out.json: [score1, score2, ...]   # 与 candidates 等长，分越高越相关

模型默认 BAAI/bge-reranker-v2-m3（中英，PRD-0005）；可用 SP_RERANK_MODEL 覆盖。
优先 FlagEmbedding.FlagReranker，回退 sentence-transformers.CrossEncoder。
若环境未安装重排库，退出码非 0，调用方优雅降级为「不重排」。
"""
import argparse, json, os, sys

MODEL = os.environ.get("SP_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")


def maybe_offline(model):
    """模型已在 HF 缓存时默认离线，避免 hub 联网检查卡住；首次需下载设 SP_FORCE_ONLINE=1。"""
    if os.environ.get("SP_FORCE_ONLINE"):
        return
    from pathlib import Path
    home = os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface")
    cached = Path(home) / "hub" / ("models--" + model.replace("/", "--"))
    if cached.exists():
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


maybe_offline(MODEL)


def rerank_flag(query, cands):
    from FlagEmbedding import FlagReranker
    m = FlagReranker(MODEL, use_fp16=True)
    scores = m.compute_score([[query, c] for c in cands], normalize=True)
    return scores if isinstance(scores, list) else [scores]


def rerank_st(query, cands):
    from sentence_transformers import CrossEncoder
    m = CrossEncoder(MODEL)
    return [float(s) for s in m.predict([[query, c] for c in cands])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--infile", required=True)
    ap.add_argument("--outfile", required=True)
    args = ap.parse_args()
    data = json.load(open(args.infile, encoding="utf-8"))
    query, cands = data.get("query", ""), data.get("candidates", [])
    if not cands:
        json.dump([], open(args.outfile, "w"))
        return

    last = None
    for fn in (rerank_flag, rerank_st):
        try:
            scores = [float(s) for s in fn(query, cands)]
            json.dump(scores, open(args.outfile, "w"))
            return
        except Exception as e:
            last = e
    print(f"reranker unavailable: {last}", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
