"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, Loader2, PlayCircle, RefreshCw, Search, UploadCloud } from "lucide-react";
import { useView } from "@/components/view-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CLAUSE_SAMPLE,
  DRAFT_SAMPLE,
  INITIAL_CLAUSES,
  INITIAL_SIGNALS,
  INTERFACE_SAMPLES,
  compareStandardText,
  beginAgentExecutionRun,
  buildAgentExecutionLog,
  buildDraftValidationStatus,
  isReadableDraftAttachment,
  isServerParsedDraftAttachment,
  isServerParsedKnowledgeAttachment,
  normalizeParsedDraftText,
  normalizeDraftAttachmentText,
  normalizeBulkSignalText,
  runDocumentValidation,
  runSearchSimulation,
  sliceKnowledgeText,
  type AgentExecutionLogLine,
  type Clause,
  type MatchResult,
  type SignalSample,
  validateDraft,
} from "@/lib/validator-demo";

type VectorHit = {
  chunk_id: string;
  text: string;
  asset_title: string;
  slide_no: number;
  chunk_type: string;
  source_method: string | null;
  score?: number;
};

function countBy<T>(items: T[], getter: (item: T) => string) {
  return items.reduce(
    (acc, item) => {
      const key = getter(item);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function confidenceVariant(score?: number): "success" | "warning" | "danger" {
  if (!score) return "warning";
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

export default function ValidatorConsole() {
  const { activeView, navigate } = useView();

  const [clauses, setClauses] = useState<Clause[]>(INITIAL_CLAUSES);
  const [signals, setSignals] = useState<SignalSample[]>(INITIAL_SIGNALS);
  const [pendingSlices, setPendingSlices] = useState<Clause[]>([]);
  const [selectedSignalIndex, setSelectedSignalIndex] = useState(0);

  const [clauseSearch, setClauseSearch] = useState("");
  const [clauseFilter, setClauseFilter] = useState("全部");
  const [kbRawText, setKbRawText] = useState("");
  const [kbSourceType, setKbSourceType] = useState("公安政务服务标准");
  const [kbUploadStatus, setKbUploadStatus] = useState("维护状态：待上传或粘贴标准文本。");

  const [draftText, setDraftText] = useState(DRAFT_SAMPLE);
  const [draftIssues, setDraftIssues] = useState<[string, string, string][]>(validateDraft(DRAFT_SAMPLE));
  const [draftSourceType, setDraftSourceType] = useState("自动识别");
  const [draftFileName, setDraftFileName] = useState("样例标准草案.txt");
  const [draftFileInputKey, setDraftFileInputKey] = useState(0);
  const [draftFileStatus, setDraftFileStatus] = useState(buildDraftValidationStatus("样例标准草案.txt", validateDraft(DRAFT_SAMPLE).length));
  const [agentTrace, setAgentTrace] = useState<AgentExecutionLogLine[]>([]);
  const [agentTraceVisible, setAgentTraceVisible] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const agentLogEndRef = useRef<HTMLDivElement | null>(null);
  const agentRunId = useRef(0);
  const [currentMatch, setCurrentMatch] = useState<MatchResult | null>(null);
  const [comparisonCount, setComparisonCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);

  const [searchKeyword, setSearchKeyword] = useState("公安政务服务 一窗通办 材料重复提交");
  const [searchScope, setSearchScope] = useState("全网公开信息");
  const [searchRegion, setSearchRegion] = useState("杭州市");
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchStatus, setSearchStatus] = useState("检索状态：待开始。");
  const [searchLog, setSearchLog] = useState<string[]>(["待获取：系统将展示检索词生成、网页召回、抓屏取证、内容清洗和样本入库进度。"]);
  const [searching, setSearching] = useState(false);

  const [bulkSource, setBulkSource] = useState("问卷调研");
  const [bulkRegion, setBulkRegion] = useState("杭州市");
  const [bulkSignals, setBulkSignals] = useState("");
  const [bulkFileStatus, setBulkFileStatus] = useState(
    "文件状态：未选择文件。文本类文件可直接读取；Word、PDF、表格等由解析服务抽取正文。"
  );
  const [interfacePlatform, setInterfacePlatform] = useState("警小爱");
  const [interfaceDataType, setInterfaceDataType] = useState("咨询问答");
  const [interfaceStatus, setInterfaceStatus] = useState("接口状态：未连接。请选择平台后测试或同步数据。");

  const [vectorFile, setVectorFile] = useState<File | null>(null);
  const [vectorStatus, setVectorStatus] = useState("VLM 入库状态：未执行。");
  const [vectorIngesting, setVectorIngesting] = useState(false);
  const [vectorQuery, setVectorQuery] = useState("材料不齐全时线上线下是否一致");
  const [vectorHits, setVectorHits] = useState<VectorHit[]>([]);
  const [vectorSearching, setVectorSearching] = useState(false);

  const [toast, setToast] = useState("");

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 1600);
  };

  useEffect(() => {
    agentLogEndRef.current?.scrollIntoView({ block: "end" });
  }, [agentTrace]);

  const playAgentLog = async (lines: AgentExecutionLogLine[]) => {
    const run = beginAgentExecutionRun(agentRunId.current);
    const runId = run.runId;
    agentRunId.current = run.currentRunId;
    setAgentTraceVisible(true);
    setAgentRunning(false);
    setAgentTrace([]);
    setAgentRunning(true);
    for (const line of lines) {
      await new Promise((resolve) => setTimeout(resolve, 70));
      if (agentRunId.current !== runId) return;
      setAgentTrace((prev) => prev.concat(line));
    }
    if (agentRunId.current === runId) setAgentRunning(false);
  };

  const filteredClauses = useMemo(
    () =>
      clauses.filter((clause) => {
        const hitKeyword =
          !clauseSearch.trim() || [clause.id, clause.source, clause.dimension, clause.text, clause.constraint].join(" ").includes(clauseSearch.trim());
        const hitFilter = clauseFilter === "全部" || clause.dimension === clauseFilter;
        return hitKeyword && hitFilter;
      }),
    [clauses, clauseSearch, clauseFilter]
  );

  const issueCount = draftIssues.length;
  const dimensionStats = useMemo(() => countBy(clauses, (item) => item.dimension), [clauses]);
  const sourceStats = useMemo(() => countBy(clauses, (item) => item.source), [clauses]);
  const signalStats = useMemo(() => countBy(signals, (item) => item.source), [signals]);

  const effectiveMatch = currentMatch || compareStandardText(draftText || CLAUSE_SAMPLE, clauses);
  const reportText = `标准条款比对报告 · ${effectiveMatch.clause.id}

待验证条款：
${effectiveMatch.targetText}

数据库依据：
${effectiveMatch.clause.source} / ${effectiveMatch.clause.id}：${effectiveMatch.clause.text}

比对结论：
综合置信度 ${effectiveMatch.score} 分，${effectiveMatch.conclusion}。

差异风险：
${effectiveMatch.issues.join("；")}

复核状态：
待专家确认。报告结论仅作为条款修订和标准复核参考，不直接替代人工论证。`;

  const onAutoSliceKb = () => {
    const slices = sliceKnowledgeText(kbRawText, kbSourceType, clauses.length);
    setPendingSlices(slices);
    setKbUploadStatus(`维护状态：已生成 ${slices.length} 个条款切片，待确认入库。`);
    showToast(`已自动切分 ${slices.length} 条`);
  };

  const onImportSlices = () => {
    if (!pendingSlices.length) {
      showToast("请先自动切分");
      return;
    }
    setClauses((prev) => prev.concat(pendingSlices));
    setKbRawText("");
    setPendingSlices([]);
    setKbUploadStatus(`维护状态：已入库 ${pendingSlices.length} 个切片，并刷新知识库索引。`);
    showToast(`已入库 ${pendingSlices.length} 个切片`);
  };

  const onKnowledgeFileChange = async (file: File | undefined) => {
    if (!file) return;
    setPendingSlices([]);
    if (isServerParsedKnowledgeAttachment(file.name)) {
      setKbUploadStatus(`维护状态：正在解析 ${file.name}，请稍候。`);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/text/extract", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "文档正文解析失败");
        const text = normalizeParsedDraftText(String(data.text || ""));
        if (!text) throw new Error("未提取到可切分的正文");
        setKbRawText(text);
        setKbUploadStatus(`维护状态：已解析 ${file.name} 正文，可执行自动切分。`);
        showToast(`已解析 ${file.name}`);
      } catch (error) {
        setKbUploadStatus(`维护状态：${file.name} 解析失败。${String(error).replace(/^Error:\s*/, "")}`);
        showToast("知识库文档解析失败");
      }
      return;
    }

    const textLike = /\.(txt|md|markdown|html|htm|xml|json|csv)$/i.test(file.name);
    if (!textLike) {
      setKbUploadStatus(`维护状态：已选择 ${file.name}，当前支持 TXT/MD/HTML/XML/JSON/CSV/PDF/DOC/DOCX 自动读取。`);
      return;
    }
    const text = normalizeDraftAttachmentText(await file.text(), file.name);
    setKbRawText(text);
    setKbUploadStatus(`维护状态：已读取 ${file.name}，可执行自动切分。`);
  };

  const onValidateDraft = () => {
    const result = runDocumentValidation(draftText, clauses);
    setDraftIssues(result.issues);
    setCurrentMatch(result.match);
    setComparisonCount((v) => v + 1);
    setReportCount((v) => v + 1);
    setDraftFileStatus(buildDraftValidationStatus(draftFileName || "粘贴文本", result.issues.length));
    void playAgentLog(
      buildAgentExecutionLog({
        text: draftText,
        sourceType: draftSourceType,
        fileName: draftFileName || "粘贴文本",
        issues: result.issues,
        match: result.match,
      })
    );
    showToast("文本验证完成");
  };

  const onDraftFileChange = async (file: File | undefined) => {
    if (!file) return;
    setDraftFileName(file.name);
    agentRunId.current += 1;
    setAgentRunning(false);
    setAgentTrace([]);
    if (isServerParsedDraftAttachment(file.name)) {
      setDraftFileStatus(`文档状态：正在解析 ${file.name}，请稍候。`);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/text/extract", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Word 正文解析失败");
        const text = normalizeParsedDraftText(String(data.text || ""));
        setDraftText(text);
        setDraftIssues([]);
        setDraftFileStatus(`文档状态：已读取 ${file.name} 正文，可点击“开始验证”。`);
        showToast(`已读取 ${file.name}`);
      } catch (error) {
        setDraftFileStatus(`文档状态：${file.name} 解析失败。${String(error).replace(/^Error:\s*/, "")}`);
        showToast("Word 文件解析失败");
      }
      return;
    }
    if (!isReadableDraftAttachment(file.name)) {
      setDraftFileStatus(`文档状态：已选择 ${file.name}。当前仅支持 TXT/MD/HTML/CSV/JSON/XML/LOG/DOC/DOCX，可先粘贴正文后开始验证。`);
      showToast("当前附件格式暂不支持自动读取");
      return;
    }
    const raw = await file.text();
    const normalized = normalizeDraftAttachmentText(raw, file.name);
    setDraftText(normalized);
    setDraftIssues([]);
    setDraftFileStatus(`文档状态：已读取 ${file.name}，可点击“开始验证”。`);
    showToast(`已读取 ${file.name}`);
  };

  const appendSignal = (source: string, text: string, region = "杭州市", type = "接入样本") => {
    setSignals((prev) => {
      const next = prev.concat({
        id: `S-${String(prev.length + 1).padStart(3, "0")}`,
        source,
        region,
        type,
        text,
        status: "待复核",
      });
      setSelectedSignalIndex(next.length - 1);
      return next;
    });
  };

  const onRunAiSearch = async () => {
    if (!searchKeyword.trim()) {
      showToast("请先输入检索主题");
      return;
    }
    setSearching(true);
    setSearchProgress(0);
    setSearchLog([`0% 已创建检索任务：${searchKeyword} / ${searchScope}`]);
    const steps: [number, string, string][] = [
      [14, "生成检索词", "AI 扩展同义词、事项名称和群众表达方式。"],
      [31, "公开网页召回", "调用搜索引擎召回政府网站留言、新闻公开页和问政平台线索。"],
      [48, "自动化搜索抓屏", "模拟打开结果页、截取页面证据并记录来源时间。"],
      [66, "内容清洗去重", "过滤重复片段、广告内容和非政务服务相关信息。"],
      [82, "舆情语义抽取", "抽取问题对象、办理环节、群众诉求和风险标签。"],
      [100, "样本入库完成", "生成公开网络舆情样本，保留检索主题和抓屏来源。"],
    ];
    for (const [percent, status, line] of steps) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      setSearchProgress(percent);
      setSearchStatus(`检索状态：${status}`);
      setSearchLog((prev) => prev.concat(`${percent}% ${line}`));
    }
    runSearchSimulation(searchKeyword).forEach((item) => appendSignal("AI检索抓屏", item, searchRegion, `公开网络-${searchScope}`));
    setSearching(false);
    showToast("已获取 3 条公开网络舆情样本");
  };

  const onImportBulkSignals = () => {
    const lines = normalizeBulkSignalText(bulkSignals)
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!lines.length) {
      showToast("请先粘贴或选择批量样本文件");
      return;
    }
    lines.forEach((line) => appendSignal(bulkSource, line, bulkRegion, "批量导入"));
    setBulkSignals("");
    setBulkFileStatus(`文件状态：已完成 ${lines.length} 条样本导入，来源已按“${bulkSource} / ${bulkRegion}”留痕。`);
    showToast(`已批量导入 ${lines.length} 条样本`);
  };

  const onBulkFileChange = async (file: File | undefined) => {
    if (!file) return;
    const textLike = /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|log)$/i.test(file.name);
    if (!textLike) {
      setBulkFileStatus(
        `文件状态：已选择 ${file.name}。当前格式需解析服务处理，可先将正文粘贴到文本框导入。`
      );
      showToast("已选择文件，当前格式需解析服务处理");
      return;
    }
    const raw = await file.text();
    const normalized = normalizeBulkSignalText(raw, file.name);
    setBulkSignals(normalized);
    const lines = normalized.split(/\n+/).filter(Boolean).length;
    setBulkFileStatus(`文件状态：已读取 ${file.name}，识别 ${lines} 条候选样本，可校对后点击批量导入。`);
    showToast(`已读取 ${lines} 条候选样本`);
  };

  const onSyncInterface = () => {
    const samples = INTERFACE_SAMPLES[interfacePlatform] || [];
    samples.forEach((item) => appendSignal(interfacePlatform, item, "杭州市", `接口同步-${interfaceDataType}`));
    setInterfaceStatus(`接口状态：已从${interfacePlatform}同步 ${samples.length} 条${interfaceDataType}样本，完成自动脱敏、去重和来源留痕。`);
    showToast(`已同步 ${samples.length} 条平台样本`);
  };

  const onRunAll = () => {
    const result = runDocumentValidation(draftText || DRAFT_SAMPLE, clauses);
    if (!draftText.trim()) setDraftText(DRAFT_SAMPLE);
    setDraftIssues(result.issues);
    setCurrentMatch(result.match);
    setDraftFileStatus(buildDraftValidationStatus(draftFileName || "样例标准草案.txt", result.issues.length));
    void playAgentLog(
      buildAgentExecutionLog({
        text: draftText || DRAFT_SAMPLE,
        sourceType: draftSourceType,
        fileName: draftFileName || "样例标准草案.txt",
        issues: result.issues,
        match: result.match,
      })
    );
    setComparisonCount((v) => v + 1);
    setReportCount((v) => v + 1);
    navigate("check");
    showToast("全链路验证完成");
  };

  const onReset = () => {
    setClauses(INITIAL_CLAUSES);
    setSignals(INITIAL_SIGNALS);
    setSelectedSignalIndex(0);
    setPendingSlices([]);
    setKbRawText("");
    setDraftText(DRAFT_SAMPLE);
    setDraftIssues(validateDraft(DRAFT_SAMPLE));
    setDraftSourceType("自动识别");
    setDraftFileName("样例标准草案.txt");
    setDraftFileInputKey((v) => v + 1);
    setDraftFileStatus(buildDraftValidationStatus("样例标准草案.txt", validateDraft(DRAFT_SAMPLE).length));
    setAgentTrace([]);
    setAgentTraceVisible(true);
    setCurrentMatch(null);
    setComparisonCount(0);
    setReportCount(0);
    setVectorHits([]);
    setVectorStatus("VLM 入库状态：未执行。");
    navigate("overview");
    showToast("已重置");
  };

  const onCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      showToast("报告摘要已复制");
    } catch {
      showToast("复制失败，请手动复制");
    }
  };

  const onVectorIngest = async () => {
    if (!vectorFile) {
      showToast("请先选择标准文档文件");
      return;
    }
    setVectorIngesting(true);
    setVectorStatus("VLM 入库状态：解析中，请稍候...");
    try {
      const form = new FormData();
      form.append("file", vectorFile);
      form.append("title", vectorFile.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/vector/ingest-file", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "入库失败");
      setVectorStatus(
        `VLM 入库状态：完成。解析 ${data?.parsed?.pages || 0} 页，补全向量 ${data?.embed?.embedded || 0} 条。`
      );
      showToast("VLM 解析与向量入库完成");
    } catch (error) {
      setVectorStatus(`VLM 入库状态：失败。${String(error)}`);
      showToast("VLM 入库失败");
    } finally {
      setVectorIngesting(false);
    }
  };

  const onVectorSearch = async () => {
    if (!vectorQuery.trim()) {
      showToast("请输入语义检索问题");
      return;
    }
    setVectorSearching(true);
    try {
      const res = await fetch("/api/vector/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: vectorQuery, k: 6 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "检索失败");
      setVectorHits((data.hits || []) as VectorHit[]);
      showToast(`已返回 ${(data.hits || []).length} 条结果`);
    } catch (error) {
      showToast(String(error));
    } finally {
      setVectorSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">政务服务标准验证智能体</h1>
            <p className="text-sm text-muted-foreground">两库一引擎一工作台一报告中心，支持条款级验证与全流程可视化。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onRunAll}>
              <PlayCircle className="h-4 w-4" />
              运行全链路验证
            </Button>
            <Button variant="outline" onClick={onReset}>
              <RefreshCw className="h-4 w-4" />
              重置样例
            </Button>
            <Button variant="primary" onClick={onCopyReport}>
              <Copy className="h-4 w-4" />
              复制报告摘要
            </Button>
          </div>
        </div>
      </Card>

      {activeView === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="space-y-1"><div className="text-2xl font-semibold">{clauses.length}</div><div className="text-sm text-muted-foreground">已切片标准条款</div></Card>
            <Card className="space-y-1"><div className="text-2xl font-semibold">{signals.length}</div><div className="text-sm text-muted-foreground">舆情与调研样本</div></Card>
            <Card className="space-y-1"><div className="text-2xl font-semibold">{comparisonCount}</div><div className="text-sm text-muted-foreground">累计比对次数</div></Card>
            <Card className="space-y-1"><div className="text-2xl font-semibold">{reportCount}</div><div className="text-sm text-muted-foreground">已生成比对报告</div></Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <h3 className="font-semibold">知识库切片分类</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.entries(dimensionStats).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <span>{name}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="font-semibold">标准来源分布</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.entries(sourceStats).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <span className="truncate pr-4">{name}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <h3 className="font-semibold">舆情与调研数据</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.entries(signalStats).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <span>{name}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">置信度与比对产出</h3>
                <Badge variant={confidenceVariant(currentMatch?.score)}>{currentMatch ? `${currentMatch.score}%` : "待比对"}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span>当前条款置信度</span><b>{currentMatch ? `${currentMatch.score}%` : "待运行"}</b></div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span>最高相似条款</span><b>{currentMatch ? currentMatch.clause.id : "待运行"}</b></div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span>比对报告数量</span><b>{reportCount} 份</b></div>
                <div className="rounded-md border border-border px-3 py-2"><span className="text-muted-foreground">最近结论：</span>{currentMatch ? currentMatch.conclusion : "尚未运行条款比对"}</div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeView === "knowledge" && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">标准知识库</h2>
            <Badge variant="info">条款级切片</Badge>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="font-medium">知识库维护</h3>
            <div className="grid gap-2 lg:grid-cols-3">
              <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={kbSourceType} onChange={(e) => setKbSourceType(e.target.value)}>
                {["公安政务服务标准", "法律法规", "国家标准", "行业标准", "地方细则", "办事指南", "调研报告"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <Input placeholder="可上传 PDF/Word/文本文件或直接粘贴正文" readOnly />
              <input
                className="block h-9 w-full rounded-lg border border-border px-3 py-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1"
                type="file"
                accept=".txt,.md,.markdown,.html,.htm,.xml,.json,.csv,.doc,.docx,.pdf,.wps,.et,.dps"
                onChange={(e) => onKnowledgeFileChange(e.target.files?.[0])}
              />
            </div>
            <textarea className="min-h-28 w-full rounded-lg border border-border bg-background p-3 text-sm" value={kbRawText} onChange={(e) => setKbRawText(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onAutoSliceKb}>自动切分</Button>
              <Button variant="primary" onClick={onImportSlices}>确认入库</Button>
              <Button variant="ghost" onClick={() => { setPendingSlices([]); setKbRawText(""); setKbUploadStatus("维护状态：待上传或粘贴标准文本。"); }}>清空</Button>
            </div>
            <p className="text-xs text-muted-foreground">{kbUploadStatus}</p>
            {!!pendingSlices.length && (
              <div className="space-y-2">
                {pendingSlices.map((slice) => (
                  <div key={slice.id} className="rounded-md border border-border p-2 text-sm">
                    <b>{slice.id}</b> · {slice.dimension} · {slice.constraint}
                    <p className="mt-1 text-muted-foreground">{slice.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <h3 className="font-medium">VLM 文档解析与向量检索（SalesPilot 核心能力）</h3>
            <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
              <input
                className="block h-9 w-full rounded-lg border border-border px-3 py-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1"
                type="file"
                accept=".ppt,.pptx,.pdf,.doc,.docx"
                onChange={(e) => setVectorFile(e.target.files?.[0] || null)}
              />
              <Button variant="outline" onClick={onVectorIngest} disabled={vectorIngesting}>
                {vectorIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                VLM解析入库
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const res = await fetch("/api/vector/embed-missing", { method: "POST" });
                  const data = await res.json();
                  setVectorStatus(`向量补全完成：${data.embedded || 0} 条。`);
                  showToast("已执行向量补全");
                }}
              >
                补全缺失向量
              </Button>
            </div>
            <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
              <Input value={vectorQuery} onChange={(e) => setVectorQuery(e.target.value)} placeholder="输入语义检索问题，例如：材料补正一次性告知要求" />
              <Button variant="primary" onClick={onVectorSearch} disabled={vectorSearching}>
                {vectorSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                语义检索
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{vectorStatus}</p>
            {!!vectorHits.length && (
              <div className="space-y-2">
                {vectorHits.map((hit) => (
                  <div key={hit.chunk_id} className="rounded-md border border-border p-2 text-sm">
                    <div className="font-medium">
                      {hit.asset_title} · 第 {hit.slide_no} 页 · {hit.chunk_type}
                    </div>
                    <p className="mt-1 text-muted-foreground">{hit.text.slice(0, 180)}{hit.text.length > 180 ? "..." : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <Input value={clauseSearch} onChange={(e) => setClauseSearch(e.target.value)} placeholder="检索条款、事项、材料、目录、安全、评价等关键词" />
            <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={clauseFilter} onChange={(e) => setClauseFilter(e.target.value)}>
              {["全部", "流程", "材料", "资源", "安全", "评价"].map((item) => (
                <option key={item} value={item}>
                  {item === "全部" ? "全部维度" : item}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2">条款 ID</th>
                  <th className="px-3 py-2">来源标准</th>
                  <th className="px-3 py-2">验证维度</th>
                  <th className="px-3 py-2">条款摘要</th>
                  <th className="px-3 py-2">约束</th>
                </tr>
              </thead>
              <tbody>
                {filteredClauses.map((clause) => (
                  <tr key={clause.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{clause.id}</td>
                    <td className="px-3 py-2">{clause.source}</td>
                    <td className="px-3 py-2">{clause.dimension}</td>
                    <td className="px-3 py-2 text-muted-foreground">{clause.text}</td>
                    <td className="px-3 py-2">{clause.constraint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeView === "check" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">文本验证</h2>
              <p className="mt-1 text-sm text-muted-foreground">上传标准草案文档后，自动提取正文并进行格式、术语、逻辑和可执行性检查。</p>
            </div>
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm text-muted-foreground">
                支持 TXT、MD、HTML、CSV、JSON、XML、LOG、DOC、DOCX。PDF、WPS 可先提取正文后粘贴验证。
              </p>
              <div className="grid gap-2 lg:grid-cols-[1fr_1fr]">
                <select
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                  value={draftSourceType}
                  onChange={(e) => setDraftSourceType(e.target.value)}
                >
                  {["自动识别", "标准草案", "办事指南", "政策条文", "调研材料"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <input
                  key={draftFileInputKey}
                  className="block h-9 w-full rounded-lg border border-border px-3 py-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1"
                  type="file"
                  accept=".txt,.md,.markdown,.html,.htm,.xml,.json,.csv,.tsv,.log,.doc,.docx,.pdf,.wps"
                  onChange={(e) => onDraftFileChange(e.target.files?.[0])}
                />
              </div>
              <textarea
                className="min-h-[220px] w-full rounded-lg border border-border bg-background p-3 text-sm"
                placeholder="也可以直接粘贴标准草案正文，点击“开始验证”。"
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  if (!draftFileName) setDraftFileName("粘贴文本");
                }}
              />
              <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">{draftFileStatus}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onValidateDraft} disabled={agentRunning}>开始验证</Button>
              <Button
                variant="outline"
                onClick={() => {
                  const issues = validateDraft(DRAFT_SAMPLE);
                  setDraftText(DRAFT_SAMPLE);
                  setDraftIssues(issues);
                  setDraftFileName("样例标准草案.txt");
                  setDraftFileStatus(buildDraftValidationStatus("样例标准草案.txt", issues.length));
                  agentRunId.current += 1;
                  setAgentRunning(false);
                  setAgentTrace([]);
                }}
              >
                载入样例文档
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraftText("");
                  setDraftIssues([]);
                  setDraftFileName("粘贴文本");
                  setDraftFileInputKey((v) => v + 1);
                  setDraftFileStatus("文档状态：待上传附件或粘贴标准草案正文。");
                  agentRunId.current += 1;
                  setAgentRunning(false);
                  setAgentTrace([]);
                }}
              >
                清空
              </Button>
            </div>
          </Card>
          <Card className="space-y-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-100 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">智能体执行窗口</h2>
                  <p className="mt-1 text-xs text-slate-400">滚动日志 · 执行过程 · 推理摘要 · 判断依据</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={agentRunning ? "warning" : agentTrace.length ? "success" : "warning"}>{agentRunning ? "执行中" : agentTrace.length ? "已完成" : "待执行"}</Badge>
                  <button
                    type="button"
                    className="h-8 rounded-md border border-slate-700 px-3 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => setAgentTraceVisible((value) => !value)}
                  >
                    {agentTraceVisible ? "收起" : "展开"}
                  </button>
                </div>
              </div>
              {agentTraceVisible && (
                <div className="mt-3 h-[360px] overflow-y-auto rounded-md border border-slate-800 bg-black/30 p-3 font-mono text-[12px] leading-5">
                  {agentTrace.length ? (
                    <div className="space-y-2">
                      {agentTrace.map((line, index) => (
                        <div key={`${line.time}-${line.phase}-${index}`} className="grid gap-2 border-b border-slate-900/80 pb-2 last:border-b-0 md:grid-cols-[72px_86px_1fr]">
                          <span className="text-slate-500">{line.time}</span>
                          <span
                            className={`w-fit rounded px-1.5 py-0.5 text-[10px] uppercase ${
                              line.kind === "system"
                                ? "bg-cyan-500/15 text-cyan-200"
                                : line.kind === "action"
                                  ? "bg-blue-500/15 text-blue-200"
                                  : line.kind === "reasoning"
                                    ? "bg-amber-500/15 text-amber-200"
                                    : line.kind === "evidence"
                                      ? "bg-violet-500/15 text-violet-200"
                                      : "bg-emerald-500/15 text-emerald-200"
                            }`}
                          >
                            {({ system: "系统", action: "执行", reasoning: "推理", evidence: "证据", result: "结果" } as const)[line.kind]}
                          </span>
                          <p className="break-words text-slate-300">
                            <span className="mr-2 text-slate-500">[{line.phase}]</span>
                            {line.message}
                          </p>
                        </div>
                      ))}
                      <div ref={agentLogEndRef} />
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">点击“开始验证”后，滚动展示完整执行过程、推理摘要、判断依据和输出结果。</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">校验结果</h2>
              <Badge variant={issueCount > 2 ? "danger" : issueCount > 0 ? "warning" : "success"}>{issueCount} 项</Badge>
            </div>
            <div className="space-y-2">
              {draftIssues.length ? (
                draftIssues.map(([level, title, detail], index) => (
                  <div key={index} className="rounded-md border border-border p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      <Badge variant={level === "高" ? "danger" : level === "中" ? "warning" : "info"}>{level}</Badge>
                      {title}
                    </div>
                    <p className="text-muted-foreground">{detail}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">上传或粘贴正文后，点击“开始验证”查看问题清单和条款比对结果。</div>
              )}
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">比对结论</h2>
                <Badge variant={confidenceVariant(currentMatch?.score)}>{currentMatch ? `${currentMatch.score} 分` : "待验证"}</Badge>
              </div>
              {!currentMatch ? (
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">开始验证后，系统会自动匹配知识库中最相似的标准条款。</div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="rounded-md border border-border p-3"><b>数据库最相似条款：</b>{currentMatch.clause.id} {currentMatch.clause.text}</div>
                  <div className="rounded-md border border-border p-3"><b>相似命中：</b>{currentMatch.overlap.length ? currentMatch.overlap.join("、") : "无明显关键词命中"}（相似度 {currentMatch.similarity}%）</div>
                  <div className="rounded-md border border-border p-3">
                    <b>差异与风险：</b>
                    <ul className="ml-5 list-disc">
                      {currentMatch.issues.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-md border border-border p-3"><b>比对结论：</b>{currentMatch.conclusion}</div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeView === "signals" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">舆情与调研样本</h2>
              <Badge variant="info">{signals.length} 条</Badge>
            </div>
            <div className="space-y-2">
              {signals.map((signal, index) => (
                <button
                  type="button"
                  key={signal.id}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selectedSignalIndex === index ? "border-primary bg-accent" : "border-border"}`}
                  onClick={() => setSelectedSignalIndex(index)}
                >
                  <div className="font-medium">{signal.id} · {signal.source} · {signal.region}</div>
                  <p className="mt-1 text-muted-foreground">{signal.text}</p>
                </button>
              ))}
            </div>
          </Card>
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">样本接入中心</h2>
            <div className="space-y-2 rounded-md border border-border p-3">
              <h3 className="font-medium">数据检索引擎</h3>
              <div className="grid gap-2">
                <Input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} />
                <div className="grid gap-2 lg:grid-cols-2">
                  <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={searchScope} onChange={(e) => setSearchScope(e.target.value)}>
                    {["全网公开信息", "政府网站留言", "地方问政平台", "新闻资讯公开页", "社交媒体公开页"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={searchRegion} onChange={(e) => setSearchRegion(e.target.value)}>
                    {["杭州市", "临平区", "上城区", "拱墅区", "西湖区", "余杭区"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <Button variant="primary" onClick={onRunAiSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  开始获取
                </Button>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${searchProgress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{searchStatus}</p>
                <div className="max-h-36 overflow-auto rounded-md border border-border bg-slate-50 p-2 text-xs text-slate-700">
                  {searchLog.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <h3 className="font-medium">批量导入</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={bulkSource} onChange={(e) => setBulkSource(e.target.value)}>
                  {["问卷调研", "警小爱", "警察叔叔", "浙里办", "民呼我为", "12345 热线", "窗口评价", "政府网站留言", "专家座谈"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={bulkRegion} onChange={(e) => setBulkRegion(e.target.value)}>
                  {["杭州市", "临平区", "上城区", "拱墅区", "西湖区", "余杭区"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <input
                className="block h-9 w-full rounded-lg border border-border px-3 py-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1"
                type="file"
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.log,.doc,.docx,.pdf,.wps,.xls,.xlsx"
                onChange={(e) => onBulkFileChange(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">{bulkFileStatus}</p>
              <textarea className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" value={bulkSignals} onChange={(e) => setBulkSignals(e.target.value)} />
              <Button variant="outline" onClick={onImportBulkSignals}>批量导入样本</Button>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <h3 className="font-medium">接口数据对接</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={interfacePlatform} onChange={(e) => setInterfacePlatform(e.target.value)}>
                  {Object.keys(INTERFACE_SAMPLES).map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm" value={interfaceDataType} onChange={(e) => setInterfaceDataType(e.target.value)}>
                  {["咨询问答", "投诉建议", "办件评价", "调研回访", "系统日志"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => { setInterfaceStatus(`接口状态：${interfacePlatform} / ${interfaceDataType} 连接正常，已完成授权校验、字段映射和脱敏规则检查。`); showToast("接口测试通过"); }}>测试接口</Button>
                <Button variant="primary" onClick={onSyncInterface}>同步平台样本</Button>
              </div>
              <p className="text-xs text-muted-foreground">{interfaceStatus}</p>
            </div>
          </Card>
        </div>
      )}

      {activeView === "report" && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">专题验证报告</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => showToast("已记录专家采纳意见")}>
                <CheckCircle2 className="h-4 w-4" />
                专家确认采纳
              </Button>
              <Button variant="ghost" onClick={() => showToast("已标记需补充条款依据")}>标记需补充验证</Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-slate-50 p-4 text-sm">{reportText}</pre>
        </Card>
      )}

      {!!toast && <div className="fixed bottom-5 right-5 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
    </div>
  );
}

