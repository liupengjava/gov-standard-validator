#!/usr/bin/env python3
"""文本向量化（中文 embedding）。优先 fastembed(ONNX，轻量)，回退 sentence-transformers。

用法:
  python3 embed.py --infile in.json --outfile out.json
  in.json:  ["文本1", "文本2", ...]
  out.json: [[...vec1...], [...vec2...]]

模型默认 BAAI/bge-m3（多语，用户指定）；可用 SP_EMBED_MODEL 覆盖。
若环境未安装 embedding 库，退出码非 0，调用方会优雅降级为仅 FTS 检索。
"""
import argparse, json, os, sys

# 默认 bge-m3（1024 维，多语，dense；PRD-0005）。bge-m3 不需查询指令前缀，passage/query 同样编码。
# 若 fastembed 当前版本不含 bge-m3，会自动回退 sentence-transformers 加载；二者均归一化输出。
# 维度 512(bge-small)→1024(bge-m3)：换模型后需全量重算向量（reingest + embed_all）。
# 旧行为可经 SP_EMBED_MODEL=BAAI/bge-small-zh-v1.5 覆盖回退。
MODEL = os.environ.get("SP_EMBED_MODEL", "BAAI/bge-m3")


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


def embed_fastembed(texts):
    from fastembed import TextEmbedding
    model = TextEmbedding(model_name=MODEL)
    return [list(map(float, v)) for v in model.embed(texts)]


def embed_st(texts):
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL)
    return model.encode(texts, normalize_embeddings=True).tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--infile", required=True)
    ap.add_argument("--outfile", required=True)
    args = ap.parse_args()
    texts = json.load(open(args.infile, encoding="utf-8"))

    # 截断超长文本：bge-m3 编码时 attention 缓冲随序列长度平方增长，一批长文本会撑爆内存
    # (实测 64 条长OCR文本需 10.6GiB)。检索只需前若干 token，截到 MAXCHARS 即可，query 通常很短不受影响。
    MAXCHARS = int(os.environ.get("SP_EMBED_MAXCHARS", "1500"))
    texts = [(t or "")[:MAXCHARS] for t in texts]

    # 优先 sentence-transformers：bge-m3 不在 fastembed 支持列表内，fastembed 会尝试联网解析而卡住。
    # fastembed 仅作回退（对其原生支持的小模型如 bge-small 仍可用）。
    last = None
    for fn in (embed_st, embed_fastembed):
        try:
            vecs = fn(texts)
            json.dump(vecs, open(args.outfile, "w"), ensure_ascii=False)
            return
        except Exception as e:
            last = e
    print(f"embedding unavailable: {last}", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
