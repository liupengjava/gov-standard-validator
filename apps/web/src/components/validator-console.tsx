"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Eye, FileSearch, FileText, Loader2, Pencil, PlayCircle, RefreshCw, Save, Search, Trash2, UploadCloud, XCircle } from "lucide-react";
import { type AppView, useView } from "@/components/view-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getPdfTextQualityError, hasPdfEncodingArtifacts } from "@/lib/pdf-extract";
import {
  CLAUSE_SAMPLE,
  DRAFT_SAMPLE,
  AGENT_LOG_PLAYBACK_DELAY_MS,
  INITIAL_CLAUSES,
  INTERFACE_SAMPLES,
  buildFormattedVerificationReport,
  buildFuzzyKnowledgeSearchTasks,
  buildKnowledgeCatalogSearchTasks,
  buildKnowledgeFileAutoSlices,
  buildKnowledgeFileAsset,
  buildKnowledgeParseProgressMessage,
  buildRetrievedKnowledgeDocumentPreviewUrl,
  decodeRetrievedKnowledgeDocumentPreviewUrl,
  isRetrievedKnowledgeDocumentPreviewUrl,
  buildKnowledgeSliceProgressMessage,
  buildKeyVerificationPoints,
  buildPublicSentimentSupport,
  buildSignalImportCandidates,
  compareStandardText,
  beginAgentExecutionRun,
  buildAgentExecutionLog,
  buildAgentExecutionStepCards,
  buildAgentThinkingExecutionLog,
  buildDraftValidationStatus,
  isReadableDraftAttachment,
  isServerParsedDraftAttachment,
  isServerParsedKnowledgeAttachment,
  mergePersistentSearchSites,
  normalizeParsedDraftText,
  normalizeDraftAttachmentText,
  normalizeBulkSignalText,
  filterVectorKnowledgeClauses,
  paginatePublicSentimentVectorSamples,
  paginateVectorKnowledgeClauses,
  knowledgeClauseKey,
  nextKnowledgeVectorBuildStep,
  recordKnowledgeFileUsage,
  removeDraftTextSlice,
  resetSignalSamplesForRetest,
  runDocumentValidation,
  sliceDraftTextForReview,
  sliceKnowledgeText,
  updateDraftTextSlice,
  updateKnowledgeVectorBuild,
  verificationPointsAllConfirmed,
  type AgentExecutionLogLine,
  type Clause,
  type DraftTextSlice,
  type DraftTextSliceStatus,
  type KeyVerificationPoint,
  type KnowledgeCatalogSearchTask,
  type KnowledgeFileAsset,
  type MatchResult,
  type SignalImportCandidate,
  type SignalSample,
  type VerificationPointStatus,
  validateDraft,
} from "@/lib/validator-demo";

type SearchSite = {
  id: string;
  name: string;
  url: string;
  category: string;
};

type SignalCollectionResponse = {
  ok: boolean;
  error?: string;
  logs?: string[];
  samples?: Array<Omit<SignalSample, "id">>;
};

const DEFAULT_SEARCH_SITES: SearchSite[] = [
  { id: "gov-message", name: "政府网站留言", url: "https://www.gov.cn/hudong/", category: "政府网站留言" },
  { id: "zjzwfw", name: "浙江政务服务网", url: "https://www.zjzwfw.gov.cn/", category: "政务服务公开页" },
  { id: "hangzhou-gov", name: "杭州市人民政府", url: "https://www.hangzhou.gov.cn/", category: "地方政府公开页" },
];

const SEARCH_SITES_STORAGE_KEY = "gov-validator.searchSites.v1";
const ACTIVE_SEARCH_SITE_STORAGE_KEY = "gov-validator.activeSearchSiteId.v1";

const INITIAL_KNOWLEDGE_FILE = buildKnowledgeFileAsset({
  name: "GB/T 32168-2015 政务服务中心网上服务规范.pdf",
  sourceType: "upload",
  sourceLabel: "初始化样例",
  addedAt: "2026-07-21 09:10",
  sliceCount: INITIAL_CLAUSES.length,
  vectorProgress: 100,
});

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

function escapeReportHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildReportDocumentHtml(reportText: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>格式化验证报告</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #14304f; line-height: 1.75; padding: 32px; }
    pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; }
  </style>
</head>
<body>
  <pre>${escapeReportHtml(reportText)}</pre>
</body>
</html>`;
}

function isPdfFileName(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

function getPdfUploadTextError(text: string, fileName: string): string | null {
  return isPdfFileName(fileName) ? getPdfTextQualityError(text) : null;
}

function getKnowledgeSliceTextError(text: string, fileName: string): string | null {
  if (isPdfFileName(fileName) || hasPdfEncodingArtifacts(text)) return getPdfTextQualityError(text);
  return null;
}

function currentKnowledgeTime(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function knowledgeFileNameForCatalog(fileName: string): string {
  return /\.[a-z0-9]{2,5}$/i.test(fileName) ? fileName : `${fileName}.pdf`;
}

function normalizeSearchSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function readPersistedSearchSites(): SearchSite[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEARCH_SITES_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (site): site is SearchSite =>
        site &&
        typeof site.id === "string" &&
        typeof site.name === "string" &&
        typeof site.url === "string" &&
        typeof site.category === "string" &&
        /^https?:\/\//i.test(site.url)
    );
  } catch {
    return [];
  }
}

function persistSearchSites(sites: SearchSite[], activeSiteId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SEARCH_SITES_STORAGE_KEY, JSON.stringify(sites));
  window.localStorage.setItem(ACTIVE_SEARCH_SITE_STORAGE_KEY, activeSiteId);
}

export default function ValidatorConsole() {
  const { activeView, navigate } = useView();

  const [clauses, setClauses] = useState<Clause[]>(INITIAL_CLAUSES);
  const [signals, setSignals] = useState<SignalSample[]>([]);
  const [pendingSlices, setPendingSlices] = useState<Clause[]>([]);
  const [selectedSignalIndex, setSelectedSignalIndex] = useState(0);
  const [signalVectorPage, setSignalVectorPage] = useState(1);

  const [clauseSearch, setClauseSearch] = useState("");
  const [clauseFilter, setClauseFilter] = useState("全部");
  const [knowledgeVectorPage, setKnowledgeVectorPage] = useState(1);
  const [kbRawText, setKbRawText] = useState("");
  const [kbFileName, setKbFileName] = useState("");
  const [kbFileSourceUrl, setKbFileSourceUrl] = useState("");
  const [kbSourceType, setKbSourceType] = useState("公安政务服务标准");
  const [kbUploadStatus, setKbUploadStatus] = useState("维护状态：待上传或粘贴标准文本。");
  const [kbParsing, setKbParsing] = useState(false);
  const [kbParseProgress, setKbParseProgress] = useState(0);
  const [kbParseStatus, setKbParseStatus] = useState(buildKnowledgeParseProgressMessage(0));
  const [kbSlicing, setKbSlicing] = useState(false);
  const [kbSliceProgress, setKbSliceProgress] = useState(0);
  const [kbSliceStatus, setKbSliceStatus] = useState(buildKnowledgeSliceProgressMessage(0));
  const [knowledgeSearchMode, setKnowledgeSearchMode] = useState<"catalog" | "fuzzy">("catalog");
  const [catalogInput, setCatalogInput] = useState("GBZ 24294.3-2017\nGB/T 39554.1-2020");
  const [fuzzyKnowledgeQuery, setFuzzyKnowledgeQuery] = useState("地铁 政务服务 数据互通");
  const [fuzzyKnowledgeRegion, setFuzzyKnowledgeRegion] = useState("杭州市");
  const [catalogTasks, setCatalogTasks] = useState<KnowledgeCatalogSearchTask[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileAsset[]>(() => [INITIAL_KNOWLEDGE_FILE]);
  const [clauseAssetIds, setClauseAssetIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(INITIAL_CLAUSES.map((clause) => [knowledgeClauseKey(clause), INITIAL_KNOWLEDGE_FILE.id]))
  );
  const [activeKnowledgeLogId, setActiveKnowledgeLogId] = useState("");
  const knowledgeVectorBuildRunIds = useRef<Record<string, number>>({});

  const [draftText, setDraftText] = useState(DRAFT_SAMPLE);
  const [draftIssues, setDraftIssues] = useState<[string, string, string][]>(validateDraft(DRAFT_SAMPLE));
  const [draftSourceType, setDraftSourceType] = useState("自动识别");
  const [draftFileName, setDraftFileName] = useState("样例标准草案.txt");
  const [draftSlices, setDraftSlices] = useState<DraftTextSlice[]>(() => sliceDraftTextForReview(DRAFT_SAMPLE, "样例标准草案.txt"));
  const [draftSliceStatuses, setDraftSliceStatuses] = useState<Record<string, DraftTextSliceStatus>>({});
  const [editingDraftSliceId, setEditingDraftSliceId] = useState("");
  const [editingDraftSliceTitle, setEditingDraftSliceTitle] = useState("");
  const [editingDraftSliceText, setEditingDraftSliceText] = useState("");
  const [draftFileInputKey, setDraftFileInputKey] = useState(0);
  const [draftFileStatus, setDraftFileStatus] = useState(buildDraftValidationStatus("样例标准草案.txt", validateDraft(DRAFT_SAMPLE).length));
  const [agentTrace, setAgentTrace] = useState<AgentExecutionLogLine[]>([]);
  const [agentThinkingTrace, setAgentThinkingTrace] = useState<AgentExecutionLogLine[]>([]);
  const [agentTraceVisible, setAgentTraceVisible] = useState(true);
  const [agentRunning, setAgentRunning] = useState(false);
  const agentLogEndRef = useRef<HTMLDivElement | null>(null);
  const agentThinkingEndRef = useRef<HTMLDivElement | null>(null);
  const draftUploadInputRef = useRef<HTMLInputElement | null>(null);
  const agentRunId = useRef(0);
  const [currentMatch, setCurrentMatch] = useState<MatchResult | null>(null);
  const [comparisonCount, setComparisonCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [verificationPointStatuses, setVerificationPointStatuses] = useState<Record<string, VerificationPointStatus>>({});
  const [formattedReportText, setFormattedReportText] = useState("");

  const [searchKeyword, setSearchKeyword] = useState("公安政务服务 一窗通办 材料重复提交");
  const [searchScope, setSearchScope] = useState("全网公开信息");
  const [searchRegion, setSearchRegion] = useState("杭州市");
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchStatus, setSearchStatus] = useState("检索状态：待开始。");
  const [searchLog, setSearchLog] = useState<string[]>(["待获取：系统将展示检索词生成、来源 URL 请求、页面元数据解析、快照固化和证据链入库进度。"]);
  const [searching, setSearching] = useState(false);
  const [searchSites, setSearchSites] = useState<SearchSite[]>(() => mergePersistentSearchSites(DEFAULT_SEARCH_SITES, readPersistedSearchSites()));
  const [activeSearchSiteId, setActiveSearchSiteId] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SEARCH_SITES[0]?.id || "";
    const sites = mergePersistentSearchSites(DEFAULT_SEARCH_SITES, readPersistedSearchSites());
    const saved = window.localStorage.getItem(ACTIVE_SEARCH_SITE_STORAGE_KEY) || "";
    return sites.some((site) => site.id === saved) ? saved : sites[0]?.id || "";
  });
  const [newSearchSiteName, setNewSearchSiteName] = useState("");
  const [newSearchSiteUrl, setNewSearchSiteUrl] = useState("");

  const [bulkSource, setBulkSource] = useState("问卷调研");
  const [bulkRegion, setBulkRegion] = useState("杭州市");
  const [bulkSignals, setBulkSignals] = useState("");
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkCandidates, setBulkCandidates] = useState<SignalImportCandidate[]>([]);
  const [bulkFileStatus, setBulkFileStatus] = useState(
    "文件状态：未选择文件。文本类文件可直接读取；Word、PDF、表格等由解析服务抽取正文。"
  );
  const [interfacePlatform, setInterfacePlatform] = useState("警小爱");
  const [interfaceDataType, setInterfaceDataType] = useState("咨询问答");
  const [interfaceStatus, setInterfaceStatus] = useState("接口状态：未连接。请选择平台后测试或同步数据。");

  const [toast, setToast] = useState("");

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 1600);
  };

  useEffect(() => {
    agentLogEndRef.current?.scrollIntoView({ block: "end" });
    agentThinkingEndRef.current?.scrollIntoView({ block: "end" });
  }, [agentTrace, agentThinkingTrace]);

  useEffect(() => {
    setSignalVectorPage(1);
  }, [signals.length]);

  useEffect(() => {
    if (!searchSites.length) return;
    persistSearchSites(searchSites, activeSearchSiteId || searchSites[0]?.id || "");
  }, [searchSites, activeSearchSiteId]);

  const playAgentLog = async (lines: AgentExecutionLogLine[], thinkingLines: AgentExecutionLogLine[] = []) => {
    const run = beginAgentExecutionRun(agentRunId.current);
    const runId = run.runId;
    agentRunId.current = run.currentRunId;
    setAgentTraceVisible(true);
    setAgentRunning(false);
    setAgentTrace([]);
    setAgentThinkingTrace([]);
    setAgentRunning(true);
    const maxLength = Math.max(lines.length, thinkingLines.length);
    for (let index = 0; index < maxLength; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, AGENT_LOG_PLAYBACK_DELAY_MS));
      if (agentRunId.current !== runId) return;
      if (lines[index]) setAgentTrace((prev) => prev.concat(lines[index]));
      if (thinkingLines[index]) setAgentThinkingTrace((prev) => prev.concat(thinkingLines[index]));
    }
    if (agentRunId.current === runId) setAgentRunning(false);
  };

  const filteredClauses = useMemo(
    () =>
      filterVectorKnowledgeClauses({
        clauses,
        knowledgeFiles,
        clauseAssetIds,
        query: clauseSearch,
        dimension: clauseFilter,
      }),
    [clauses, knowledgeFiles, clauseAssetIds, clauseSearch, clauseFilter]
  );
  const completedVectorFileCount = useMemo(() => knowledgeFiles.filter((file) => file.vectorStatus === "已完成").length, [knowledgeFiles]);
  const completedVectorClauseCount = useMemo(
    () =>
      filterVectorKnowledgeClauses({
        clauses,
        knowledgeFiles,
        clauseAssetIds,
        query: "",
        dimension: "全部",
      }).length,
    [clauses, knowledgeFiles, clauseAssetIds]
  );
  const pagedVectorClauses = useMemo(
    () => paginateVectorKnowledgeClauses(filteredClauses, knowledgeVectorPage, 20),
    [filteredClauses, knowledgeVectorPage]
  );

  const issueCount = draftIssues.length;
  const dimensionStats = useMemo(() => countBy(clauses, (item) => item.dimension), [clauses]);
  const sourceStats = useMemo(() => countBy(clauses, (item) => item.source), [clauses]);
  const signalStats = useMemo(() => countBy(signals, (item) => item.source), [signals]);

  const effectiveMatch = currentMatch || compareStandardText(draftText || CLAUSE_SAMPLE, clauses);
  const publicSentimentSupport = useMemo(
    () => buildPublicSentimentSupport({ match: effectiveMatch, signals }),
    [effectiveMatch, signals]
  );
  const pagedSignalVectors = useMemo(
    () => paginatePublicSentimentVectorSamples(signals, signalVectorPage, 20),
    [signals, signalVectorPage]
  );
  const verificationPoints: KeyVerificationPoint[] = useMemo(
    () =>
      buildKeyVerificationPoints({ issues: draftIssues, match: effectiveMatch }).map((point) => {
        const status = verificationPointStatuses[point.id] || point.status;
        return {
          ...point,
          status,
          reviewStatus: status === "accepted" ? "专家已采纳" : status === "rejected" ? "专家已拒绝" : point.reviewStatus,
        };
      }),
    [draftIssues, effectiveMatch, verificationPointStatuses]
  );
  const confirmedVerificationCount = verificationPoints.filter((point) => point.status !== "pending").length;
  const allVerificationPointsConfirmed = verificationPointsAllConfirmed(verificationPoints);
  const reviewedDraftSlices = useMemo(
    () =>
      draftSlices.map((slice) => ({
        ...slice,
        status: draftSliceStatuses[slice.id] || slice.status,
      })),
    [draftSlices, draftSliceStatuses]
  );
  const confirmedDraftSliceCount = reviewedDraftSlices.filter((slice) => slice.status === "confirmed").length;
  const allDraftSlicesConfirmed = reviewedDraftSlices.length > 0 && confirmedDraftSliceCount === reviewedDraftSlices.length;
  const reportText = `标准条款比对报告 · ${effectiveMatch.clause.id}

待验证条款：
${effectiveMatch.targetText}

数据库依据：
${effectiveMatch.clause.source} / ${effectiveMatch.clause.id}：${effectiveMatch.clause.text}

比对结论：
综合置信度 ${effectiveMatch.score} 分，${effectiveMatch.conclusion}。

差异风险：
${effectiveMatch.issues.join("；")}

群众感知佐证（辅助依据）：
关联样本 ${publicSentimentSupport.sampleCount} 条；问题标签：${publicSentimentSupport.issueTags.join("、") || "暂无明确标签"}。
${publicSentimentSupport.summaries[0] || "暂无可用辅助样本。"}
${publicSentimentSupport.boundaryNote}

复核状态：
待专家确认。报告结论仅作为条款修订和标准复核参考，不直接替代人工论证。`;
  const activeKnowledgeLog = knowledgeFiles.find((file) => file.id === activeKnowledgeLogId) || null;

  const upsertKnowledgeFile = (asset: KnowledgeFileAsset) => {
    setKnowledgeFiles((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === asset.id);
      if (existingIndex === -1) return [asset, ...prev];
      return prev.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              ...asset,
              accessCount: item.accessCount,
              callCount: item.callCount,
              lastAccessedAt: item.lastAccessedAt,
              lastCalledAt: item.lastCalledAt,
              vectorLogs: [...item.vectorLogs, ...asset.vectorLogs.slice(1)],
              sourceUrl: asset.sourceUrl || item.sourceUrl,
              searchUrl: asset.searchUrl || item.searchUrl,
            }
          : item
      );
    });
  };

  const startKnowledgeVectorBuild = (fileId: string, fromProgress = 0) => {
    const runId = (knowledgeVectorBuildRunIds.current[fileId] || 0) + 1;
    knowledgeVectorBuildRunIds.current[fileId] = runId;
    const targets = [50, 72, 88, 100].filter((target) => target > fromProgress);
    void (async () => {
      for (const target of targets) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (knowledgeVectorBuildRunIds.current[fileId] !== runId) return;
        setKnowledgeFiles((prev) =>
          prev.map((item) =>
            item.id === fileId && item.vectorStatus !== "已完成"
              ? nextKnowledgeVectorBuildStep(item, currentKnowledgeTime(), target)
              : item
          )
        );
        if (target >= 100) showToast("知识库向量构建完成");
      }
    })();
  };

  const onBuildCatalogSearchTasks = () => {
    const tasks = (
      knowledgeSearchMode === "catalog"
        ? buildKnowledgeCatalogSearchTasks(catalogInput, currentKnowledgeTime())
        : buildFuzzyKnowledgeSearchTasks(fuzzyKnowledgeQuery, fuzzyKnowledgeRegion, currentKnowledgeTime())
    ).map((task) => ({
      ...task,
      message:
        task.searchMode === "fuzzy"
          ? task.message
          : "待启动检索。系统将自动检索公开来源，获取文件成功后可加入知识库。",
    }));
    setCatalogTasks(tasks);
    showToast(tasks.length ? `已生成 ${tasks.length} 个联网检索任务` : knowledgeSearchMode === "catalog" ? "请先输入文件名称目录清单" : "请先输入模糊或缺失知识条件");
  };

  const onStartCatalogSearch = async (task: KnowledgeCatalogSearchTask) => {
    setCatalogTasks((prev) =>
      prev.map((item) =>
        item.id === task.id
          ? { ...item, status: "检索中", message: `检索中：正在打开百度搜索结果，点击命中的公开来源链接，进入详情页后查找“${item.downloadActionLabel || "下载原文"}”。` }
          : item
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    setCatalogTasks((prev) =>
      prev.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: "已获取",
              matchedTitle: knowledgeFileNameForCatalog(item.fileName),
              message: `获取原文成功：已从搜索结果进入${item.detailPageUrl ? "标准详情页" : "公开详情页"}，点击“${item.downloadActionLabel || "下载原文"}”并形成 ${knowledgeFileNameForCatalog(item.fileName)} 的固化文档，请点击“加入知识库”。`,
            }
          : item
      )
    );
    showToast("获取文件成功，可加入知识库");
  };

  const onAcquireCatalogTask = (task: KnowledgeCatalogSearchTask) => {
    if (task.status !== "已获取") {
      showToast("请先启动检索并等待文件获取成功");
      return;
    }
    const addedAt = currentKnowledgeTime();
    const documentName = knowledgeFileNameForCatalog(task.fileName);
    const documentPreviewUrl = buildRetrievedKnowledgeDocumentPreviewUrl(task, documentName, addedAt);
    const asset = buildKnowledgeFileAsset({
      name: documentName,
      sourceType: "web",
      sourceLabel: task.sourceSite,
      addedAt,
      sliceCount: 0,
      vectorProgress: 0,
      sourceUrl: documentPreviewUrl,
      searchUrl: task.searchUrl,
    });
    upsertKnowledgeFile(asset);
    setCatalogTasks((prev) =>
      prev.map((item) =>
        item.id === task.id
          ? { ...item, matchedTitle: asset.name, message: "已加入知识文件列表，请先自动切分知识切片，再构建向量。" }
          : item
      )
    );
    setKbUploadStatus(`维护状态：已通过联网检索加入 ${asset.name}，请在知识文件列表中执行自动切分。`);
    showToast("已加入知识库文件列表");
  };

  const onViewKnowledgeFile = (id: string) => {
    const at = currentKnowledgeTime();
    setKnowledgeFiles((prev) => prev.map((item) => (item.id === id ? recordKnowledgeFileUsage(item, "access", at) : item)));
    setActiveKnowledgeLogId(id);
  };

  const onOpenKnowledgeFileSource = (file: KnowledgeFileAsset) => {
    const at = currentKnowledgeTime();
    setKnowledgeFiles((prev) => prev.map((item) => (item.id === file.id ? recordKnowledgeFileUsage(item, "access", at) : item)));
    if (!file.sourceUrl) {
      showToast("该知识文件暂无可查看的已获取文档，请先完成检索或上传文件");
      return;
    }
    if (isRetrievedKnowledgeDocumentPreviewUrl(file.sourceUrl)) {
      const html = decodeRetrievedKnowledgeDocumentPreviewUrl(file.sourceUrl);
      if (!html) {
        showToast("文档预览解析失败，请重新检索获取文件");
        return;
      }
      const previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      window.open(previewUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
      return;
    }
    window.open(file.sourceUrl, "_blank", "noopener,noreferrer");
  };

  const onAutoSliceKnowledgeFile = (id: string) => {
    const file = knowledgeFiles.find((item) => item.id === id);
    if (!file) return;
    const slices = buildKnowledgeFileAutoSlices(file, clauses.length);
    setClauses((prev) => {
      const existingKeys = new Set(prev.map((clause) => knowledgeClauseKey(clause)));
      const freshSlices = slices.filter((slice) => !existingKeys.has(knowledgeClauseKey(slice)));
      return freshSlices.length ? prev.concat(freshSlices) : prev;
    });
    setClauseAssetIds((prev) => ({
      ...prev,
      ...Object.fromEntries(slices.map((slice) => [knowledgeClauseKey(slice), file.id])),
    }));
    const at = currentKnowledgeTime();
    setKnowledgeFiles((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              sliceCount: slices.length,
              vectorLogs: item.vectorLogs.concat(`${at} 自动切分完成：生成 ${slices.length} 个条款级知识切片。`),
            }
          : item
      )
    );
    setActiveKnowledgeLogId(id);
    showToast(`已自动切分 ${slices.length} 个知识切片`);
  };

  const onBuildKnowledgeVector = (id: string) => {
    const file = knowledgeFiles.find((item) => item.id === id);
    if (file && file.sliceCount <= 0) {
      showToast("请先自动切分知识切片");
      return;
    }
    const at = currentKnowledgeTime();
    knowledgeVectorBuildRunIds.current[id] = (knowledgeVectorBuildRunIds.current[id] || 0) + 1;
    setKnowledgeFiles((prev) => prev.map((item) => (item.id === id ? updateKnowledgeVectorBuild(item, at) : item)));
    setActiveKnowledgeLogId(id);
    showToast("向量构建日志已更新");
  };

  const onRemoveKnowledgeFile = (id: string) => {
    knowledgeVectorBuildRunIds.current[id] = (knowledgeVectorBuildRunIds.current[id] || 0) + 1;
    setKnowledgeFiles((prev) => prev.filter((item) => item.id !== id));
    setClauseAssetIds((prev) => Object.fromEntries(Object.entries(prev).filter(([, assetId]) => assetId !== id)));
    if (activeKnowledgeLogId === id) setActiveKnowledgeLogId("");
    showToast("已移除知识文件");
  };

  const buildDraftSlicesForReview = (text: string, fileName: string) => {
    const slices = sliceDraftTextForReview(text, fileName || "待验证文本");
    setDraftSlices(slices);
    setDraftSliceStatuses({});
    setEditingDraftSliceId("");
    setEditingDraftSliceTitle("");
    setEditingDraftSliceText("");
    return slices;
  };

  const onConfirmDraftSlice = (sliceId: string) => {
    setDraftSliceStatuses((prev) => ({ ...prev, [sliceId]: "confirmed" }));
    setFormattedReportText("");
  };

  const onConfirmAllDraftSlices = () => {
    const next = Object.fromEntries(draftSlices.map((slice) => [slice.id, "confirmed" as DraftTextSliceStatus]));
    setDraftSliceStatuses(next);
    setFormattedReportText("");
    showToast("已确认全部待验证文本切片");
  };

  const onEditDraftSlice = (slice: DraftTextSlice) => {
    setEditingDraftSliceId(slice.id);
    setEditingDraftSliceTitle(slice.title);
    setEditingDraftSliceText(slice.text);
  };

  const onCancelEditDraftSlice = () => {
    setEditingDraftSliceId("");
    setEditingDraftSliceTitle("");
    setEditingDraftSliceText("");
  };

  const onSaveDraftSliceEdit = (sliceId: string) => {
    const result = updateDraftTextSlice(draftSlices, draftSliceStatuses, sliceId, {
      title: editingDraftSliceTitle,
      text: editingDraftSliceText,
    });
    setDraftSlices(result.slices);
    setDraftSliceStatuses(result.statuses);
    setDraftText(result.slices.map((slice) => slice.text).join("\n"));
    setFormattedReportText("");
    onCancelEditDraftSlice();
    showToast("已保存切片校正，请重新确认");
  };

  const onRemoveDraftSlice = (sliceId: string) => {
    const result = removeDraftTextSlice(draftSlices, draftSliceStatuses, sliceId);
    setDraftSlices(result.slices);
    setDraftSliceStatuses(result.statuses);
    setDraftText(result.slices.map((slice) => slice.text).join("\n"));
    if (editingDraftSliceId === sliceId) onCancelEditDraftSlice();
    setFormattedReportText("");
    showToast("已删除该切片");
  };

  const onAutoSliceKb = async () => {
    const qualityError = getKnowledgeSliceTextError(kbRawText, kbFileName);
    if (qualityError) {
      setPendingSlices([]);
      setKbSlicing(false);
      setKbSliceProgress(0);
      setKbSliceStatus(buildKnowledgeSliceProgressMessage(0));
      setKbUploadStatus(`维护状态：${qualityError}`);
      showToast("PDF 文本疑似乱码");
      return;
    }
    setKbSlicing(true);
    setKbSliceProgress(20);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(20));
    setKbUploadStatus("维护状态：正在准备待切分文本。");
    await new Promise((resolve) => setTimeout(resolve, 180));
    setKbSliceProgress(55);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(55));
    setKbUploadStatus("维护状态：正在识别条款编号和层级结构。");
    await new Promise((resolve) => setTimeout(resolve, 220));
    const slices = sliceKnowledgeText(kbRawText, kbSourceType, clauses.length);
    setKbSliceProgress(82);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(82));
    setKbUploadStatus("维护状态：正在生成条款级知识切片。");
    await new Promise((resolve) => setTimeout(resolve, 180));
    setPendingSlices(slices);
    setKbSliceProgress(100);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(100, slices.length));
    setKbSlicing(false);
    setKbUploadStatus(`维护状态：已生成 ${slices.length} 个条款切片，待确认入库。`);
    showToast(`已自动切分 ${slices.length} 条`);
  };

  const onImportSlices = () => {
    if (!pendingSlices.length) {
      showToast("请先自动切分");
      return;
    }
    const assetName = kbFileName || `${kbSourceType}-粘贴文本`;
    const asset = buildKnowledgeFileAsset({
      name: assetName,
      sourceType: kbFileName ? "upload" : "upload",
      sourceLabel: kbFileName ? "本地上传" : "手动粘贴",
      addedAt: currentKnowledgeTime(),
      sliceCount: pendingSlices.length,
      vectorProgress: 55,
      sourceUrl: kbFileSourceUrl,
    });
    upsertKnowledgeFile(asset);
    startKnowledgeVectorBuild(asset.id, asset.vectorProgress);
    setClauses((prev) => prev.concat(pendingSlices));
    setClauseAssetIds((prev) => ({
      ...prev,
      ...Object.fromEntries(pendingSlices.map((slice) => [knowledgeClauseKey(slice), asset.id])),
    }));
    setKbRawText("");
    setKbFileName("");
    setKbFileSourceUrl("");
    setPendingSlices([]);
    setKbParsing(false);
    setKbParseProgress(0);
    setKbParseStatus(buildKnowledgeParseProgressMessage(0));
    setKbSlicing(false);
    setKbSliceProgress(0);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(0));
    setKbUploadStatus(`维护状态：已入库 ${pendingSlices.length} 个切片，并刷新知识库索引。`);
    showToast(`已入库 ${pendingSlices.length} 个切片`);
  };

  const onKnowledgeFileChange = async (file: File | undefined) => {
    if (!file) return;
    setPendingSlices([]);
    setKbParsing(false);
    setKbParseProgress(0);
    setKbParseStatus(buildKnowledgeParseProgressMessage(0));
    setKbSlicing(false);
    setKbSliceProgress(0);
    setKbSliceStatus(buildKnowledgeSliceProgressMessage(0));
    setKbFileName(file.name);
    const sourceUrl = URL.createObjectURL(file);
    setKbFileSourceUrl(sourceUrl);
    if (isServerParsedKnowledgeAttachment(file.name)) {
      setKbParsing(true);
      setKbParseProgress(16);
      setKbParseStatus(buildKnowledgeParseProgressMessage(16));
      setKbUploadStatus(`维护状态：正在解析 ${file.name}，请稍候。`);
      try {
        await new Promise((resolve) => setTimeout(resolve, 120));
        setKbParseProgress(42);
        setKbParseStatus(buildKnowledgeParseProgressMessage(42));
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/text/extract", { method: "POST", body: form });
        setKbParseProgress(76);
        setKbParseStatus(buildKnowledgeParseProgressMessage(76));
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "文档正文解析失败");
        const text = normalizeParsedDraftText(String(data.text || ""));
        if (!text) throw new Error("未提取到可切分的正文");
        const qualityError = getPdfUploadTextError(text, file.name);
        if (qualityError) throw new Error(qualityError);
        setKbParseProgress(100);
        setKbParseStatus(buildKnowledgeParseProgressMessage(100));
        setKbParsing(false);
        setKbRawText(text);
        upsertKnowledgeFile(
          buildKnowledgeFileAsset({
            name: file.name,
            sourceType: "upload",
            sourceLabel: "本地上传",
            addedAt: currentKnowledgeTime(),
            sliceCount: 0,
            vectorProgress: 15,
            sourceUrl,
          })
        );
        setKbUploadStatus(`维护状态：已解析 ${file.name} 正文，可执行自动切分。`);
        showToast(`已解析 ${file.name}`);
      } catch (error) {
        setKbParsing(false);
        setKbParseProgress(0);
        setKbParseStatus(buildKnowledgeParseProgressMessage(0));
        setKbRawText("");
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
    setKbParseProgress(100);
    setKbParseStatus(buildKnowledgeParseProgressMessage(100));
    setKbRawText(text);
    upsertKnowledgeFile(
      buildKnowledgeFileAsset({
        name: file.name,
        sourceType: "upload",
        sourceLabel: "本地上传",
        addedAt: currentKnowledgeTime(),
        sliceCount: 0,
        vectorProgress: 15,
        sourceUrl,
      })
    );
    setKbUploadStatus(`维护状态：已读取 ${file.name}，可执行自动切分。`);
  };

  const onValidateDraft = () => {
    if (editingDraftSliceId) {
      showToast("请先保存或取消当前切片校正");
      return;
    }
    if (!reviewedDraftSlices.length) {
      const slices = buildDraftSlicesForReview(draftText, draftFileName || "待验证文本");
      setDraftFileStatus(`文档状态：已生成 ${slices.length} 个待验证文本切片，请先复核确认。`);
      showToast("请先确认待验证文本切片");
      return;
    }
    if (!allDraftSlicesConfirmed) {
      showToast("请先确认全部待验证文本切片");
      return;
    }
    const validationText = reviewedDraftSlices.map((slice) => slice.text).join("\n");
    const result = runDocumentValidation(validationText, clauses);
    setDraftText(validationText);
    setDraftIssues(result.issues);
    setCurrentMatch(result.match);
    setVerificationPointStatuses({});
    setFormattedReportText("");
    setComparisonCount((v) => v + 1);
    setReportCount((v) => v + 1);
    setDraftFileStatus(buildDraftValidationStatus(draftFileName || "粘贴文本", result.issues.length));
    const agentInput = {
      text: validationText,
      sourceType: draftSourceType,
      fileName: draftFileName || "粘贴文本",
      issues: result.issues,
      match: result.match,
      signals,
    };
    void playAgentLog(
      buildAgentExecutionLog(agentInput),
      buildAgentThinkingExecutionLog(agentInput)
    );
    showToast("文本验证完成");
  };

  const onDraftFileChange = async (file: File | undefined) => {
    if (!file) return;
    setDraftFileName(file.name);
    agentRunId.current += 1;
    setAgentRunning(false);
    setAgentTrace([]);
    setAgentThinkingTrace([]);
    setVerificationPointStatuses({});
    setFormattedReportText("");
    if (isServerParsedDraftAttachment(file.name)) {
      setDraftFileStatus(`文档状态：正在解析 ${file.name}，请稍候。`);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/text/extract", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Word 正文解析失败");
        const text = normalizeParsedDraftText(String(data.text || ""));
        const qualityError = getPdfUploadTextError(text, file.name);
        if (qualityError) throw new Error(qualityError);
        const slices = buildDraftSlicesForReview(text, file.name);
        setDraftText(text);
        setDraftIssues([]);
        setCurrentMatch(null);
        setVerificationPointStatuses({});
        setFormattedReportText("");
        setDraftFileStatus(`文档状态：已读取 ${file.name} 正文，并生成 ${slices.length} 个待验证文本切片，请复核确认后开始验证。`);
        showToast(`已读取 ${file.name}`);
      } catch (error) {
        if (isPdfFileName(file.name)) setDraftText("");
        setDraftSlices([]);
        setDraftSliceStatuses({});
        setDraftFileStatus(`文档状态：${file.name} 解析失败。${String(error).replace(/^Error:\s*/, "")}`);
        showToast(isPdfFileName(file.name) ? "PDF 文本疑似乱码" : "Word 文件解析失败");
      }
      return;
    }
    if (!isReadableDraftAttachment(file.name)) {
      setDraftSlices([]);
      setDraftSliceStatuses({});
      setDraftFileStatus(`文档状态：已选择 ${file.name}。当前仅支持 TXT/MD/HTML/CSV/JSON/XML/LOG/DOC/DOCX，可先粘贴正文后开始验证。`);
      showToast("当前附件格式暂不支持自动读取");
      return;
    }
    const raw = await file.text();
    const normalized = normalizeDraftAttachmentText(raw, file.name);
    const slices = buildDraftSlicesForReview(normalized, file.name);
    setDraftText(normalized);
    setDraftIssues([]);
    setCurrentMatch(null);
    setVerificationPointStatuses({});
    setFormattedReportText("");
    setDraftFileStatus(`文档状态：已读取 ${file.name}，并生成 ${slices.length} 个待验证文本切片，请复核确认后开始验证。`);
    showToast(`已读取 ${file.name}`);
  };

  const appendSignal = (
    source: string,
    text: string,
    region = "杭州市",
    type = "接入样本",
    meta: Partial<Omit<SignalSample, "id" | "source" | "region" | "type" | "text" | "status">> = {}
  ) => {
    setSignals((prev) => {
      const next = prev.concat({
        id: `S-${String(prev.length + 1).padStart(3, "0")}`,
        source,
        region,
        type,
        text,
        status: "待复核",
        ...meta,
      });
      setSelectedSignalIndex(next.length - 1);
      return next;
    });
  };

  const activeSearchSite = searchSites.find((site) => site.id === activeSearchSiteId) || searchSites[0] || null;

  const onRunAiSearch = async () => {
    if (!searchKeyword.trim()) {
      showToast("请先输入检索主题");
      return;
    }
    setSearching(true);
    setSearchProgress(0);
    setSearchLog([`0% 已创建检索任务：${searchKeyword} / ${searchScope}${activeSearchSite ? ` / ${activeSearchSite.name}` : ""}`]);
    const steps: [number, string, string][] = [
      [14, "生成检索词", "AI 扩展同义词、事项名称和群众表达方式。"],
      [31, "来源 URL 请求", `调用${activeSearchSite ? activeSearchSite.name : "维护网址"}获取公开网页原始响应。`],
      [48, "页面证据固化", "解析页面标题、发布时间，生成 HTML 快照并记录采集时间。"],
      [66, "内容清洗去重", "过滤重复片段、广告内容和非政务服务相关信息。"],
      [82, "舆情语义抽取", "抽取问题对象、办理环节、群众诉求和风险标签。"],
      [100, "样本入库完成", "生成公开网络舆情样本，保留来源 URL、页面标题、发布时间、快照和证据链。"],
    ];
    for (const [percent, status, line] of steps) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      setSearchProgress(percent);
      setSearchStatus(`检索状态：${status}`);
      setSearchLog((prev) => prev.concat(`${percent}% ${line}`));
    }
    try {
      const sites = activeSearchSite ? [activeSearchSite] : searchSites;
      const response = await fetch("/api/signals/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: searchKeyword,
          region: searchRegion,
          scope: searchScope,
          sites,
        }),
      });
      const data = (await response.json()) as SignalCollectionResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "真实采集失败");
      const samples = data.samples || [];
      if (!samples.length) throw new Error("未从来源 URL 中抽取到可入库样本");
      setSignals((prev) => {
        const next = prev.concat(
          samples.map((item, index) => ({
            ...item,
            id: `S-${String(prev.length + index + 1).padStart(3, "0")}`,
          }))
        );
        setSelectedSignalIndex(next.length - 1);
        return next;
      });
      setSearchProgress(100);
      setSearchStatus(`检索状态：真实采集完成，已生成 ${samples.length} 条带证据链样本`);
      setSearchLog((prev) =>
        prev.concat(data.logs || []).concat(
          samples.map((item) => `100% 已入库：${item.pageTitle || item.source} / ${item.sourceUrl || "来源 URL 未返回"}`)
        )
      );
      showToast(`已真实采集 ${samples.length} 条样本`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchStatus(`检索状态：真实采集失败 - ${message}`);
      setSearchLog((prev) => prev.concat(`采集失败：${message}`));
      showToast("真实采集失败，请检查来源 URL");
    } finally {
      setSearching(false);
    }
  };

  const onImportBulkSignals = () => {
    if (bulkCandidates.length) {
      bulkCandidates.forEach((candidate) =>
        appendSignal(candidate.source, candidate.text, candidate.region, candidate.type, {
          confidence: candidate.confidence,
          confidenceParts: candidate.confidenceParts,
          matchedClauseId: candidate.matchedClauseId,
          matchedClauseSource: candidate.matchedClauseSource,
          evaluationText: candidate.evaluationText,
          reviewStatus: candidate.reviewStatus,
          evidenceStatus: "imported",
        })
      );
      setBulkSignals("");
      setBulkCandidates([]);
      setBulkFileStatus(`文件状态：已完成 ${bulkCandidates.length} 条解析样本导入，置信度和命中条款已随样本留痕。`);
      showToast(`已导入 ${bulkCandidates.length} 条解析样本`);
      return;
    }
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
    setBulkCandidates([]);
    setBulkFileStatus(`文件状态：已完成 ${lines.length} 条样本导入，来源已按“${bulkSource} / ${bulkRegion}”留痕。`);
    showToast(`已批量导入 ${lines.length} 条样本`);
  };

  const onClearSignalSamples = () => {
    const reset = resetSignalSamplesForRetest(signals, selectedSignalIndex);
    setSignals(reset.signals);
    setSelectedSignalIndex(reset.selectedSignalIndex);
    setBulkSignals("");
    setBulkCandidates([]);
    setBulkFile(null);
    setBulkParsing(false);
    setBulkFileStatus("文件状态：已清空舆情与调研样本，可重新选择文件并一键解析。");
    showToast("已清空舆情与调研样本");
  };

  const onBulkFileChange = async (file: File | undefined) => {
    if (!file) return;
    setBulkFile(file);
    setBulkCandidates([]);
    const textLike = /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|log)$/i.test(file.name);
    if (!textLike) {
      setBulkSignals("");
      setBulkFileStatus(
        `文件状态：已选择 ${file.name}。请点击“一键解析”抽取候选样本并生成置信度评定。`
      );
      showToast("已选择文件，可一键解析");
      return;
    }
    const raw = await file.text();
    const normalized = normalizeBulkSignalText(raw, file.name);
    setBulkSignals(normalized);
    const lines = normalized.split(/\n+/).filter(Boolean).length;
    setBulkFileStatus(`文件状态：已读取 ${file.name}，识别 ${lines} 条文本行。建议点击“一键解析”生成置信度和条款命中结果。`);
    showToast(`已读取 ${lines} 条候选样本`);
  };

  const onParseBulkSignals = async () => {
    if (!bulkFile && !bulkSignals.trim()) {
      showToast("请先选择文件或粘贴样本文本");
      return;
    }
    setBulkParsing(true);
    setBulkCandidates([]);
    try {
      let parsedText = bulkSignals;
      let parserName = "local-text";
      const fileName = bulkFile?.name || "粘贴样本.txt";
      if (bulkFile && !parsedText.trim()) {
        const form = new FormData();
        form.append("file", bulkFile);
        const useDocumentParser = /\.(doc|docx|pdf)$/i.test(bulkFile.name);
        const response = await fetch(useDocumentParser ? "/api/text/extract" : "/api/signals/parse-file", {
          method: "POST",
          body: form,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "文件解析失败");
        parsedText = normalizeBulkSignalText(String(data.text || ""), fileName);
        parserName = data.parser || (useDocumentParser ? "document-parser" : "signal-parser");
        setBulkSignals(parsedText);
      }
      const candidates = buildSignalImportCandidates(parsedText, {
        source: bulkSource,
        region: bulkRegion,
        clauses,
        fileName,
      });
      if (!candidates.length) throw new Error("未解析出可用于条款比对的样本数据");
      setBulkCandidates(candidates);
      setBulkFileStatus(`文件状态：一键解析完成，解析器 ${parserName}，生成 ${candidates.length} 条候选样本；已按相关性、完整性、可比对性、数据质量评定置信度。`);
      showToast(`已解析 ${candidates.length} 条候选样本`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBulkFileStatus(`文件状态：一键解析失败。${message}`);
      showToast("样本解析失败");
    } finally {
      setBulkParsing(false);
    }
  };

  const onOpenSearchSite = (site: SearchSite) => {
    window.open(site.url, "_blank", "noopener,noreferrer");
    showToast(`已打开 ${site.name}`);
  };

  const onAddSearchSite = () => {
    const name = newSearchSiteName.trim();
    const url = normalizeSearchSiteUrl(newSearchSiteUrl);
    if (!name || !url) {
      showToast("请填写网址名称和地址");
      return;
    }
    try {
      new URL(url);
    } catch {
      showToast("网址格式不正确");
      return;
    }
    const site: SearchSite = {
      id: `site-${Date.now()}`,
      name,
      url,
      category: searchScope,
    };
    setSearchSites((prev) => {
      const next = mergePersistentSearchSites(prev, [site]);
      persistSearchSites(next, site.id);
      return next;
    });
    setActiveSearchSiteId(site.id);
    setNewSearchSiteName("");
    setNewSearchSiteUrl("");
    showToast("已添加检索网址");
  };

  const onRemoveSearchSite = (siteId: string) => {
    const next = searchSites.filter((site) => site.id !== siteId);
    const nextActiveId = activeSearchSiteId === siteId ? next[0]?.id || "" : activeSearchSiteId;
    setSearchSites(next);
    persistSearchSites(next, nextActiveId);
    if (activeSearchSiteId === siteId) setActiveSearchSiteId(nextActiveId);
    showToast("已移除检索网址");
  };

  const onSyncInterface = () => {
    const samples = INTERFACE_SAMPLES[interfacePlatform] || [];
    samples.forEach((item) => appendSignal(interfacePlatform, item, "杭州市", `接口同步-${interfaceDataType}`));
    setInterfaceStatus(`接口状态：已从${interfacePlatform}同步 ${samples.length} 条${interfaceDataType}样本，完成自动脱敏、去重和来源留痕。`);
    showToast(`已同步 ${samples.length} 条平台样本`);
  };

  const onRunAll = () => {
    const runText = draftText || DRAFT_SAMPLE;
    const slices = sliceDraftTextForReview(runText, draftFileName || "样例标准草案.txt");
    const confirmedStatuses = Object.fromEntries(slices.map((slice) => [slice.id, "confirmed" as DraftTextSliceStatus]));
    const result = runDocumentValidation(runText, clauses);
    if (!draftText.trim()) setDraftText(DRAFT_SAMPLE);
    setDraftSlices(slices);
    setDraftSliceStatuses(confirmedStatuses);
    setDraftIssues(result.issues);
    setCurrentMatch(result.match);
    setVerificationPointStatuses({});
    setFormattedReportText("");
    setDraftFileStatus(buildDraftValidationStatus(draftFileName || "样例标准草案.txt", result.issues.length));
    const agentInput = {
      text: draftText || DRAFT_SAMPLE,
      sourceType: draftSourceType,
      fileName: draftFileName || "样例标准草案.txt",
      issues: result.issues,
      match: result.match,
      signals,
    };
    void playAgentLog(
      buildAgentExecutionLog(agentInput),
      buildAgentThinkingExecutionLog(agentInput)
    );
    setComparisonCount((v) => v + 1);
    setReportCount((v) => v + 1);
    navigate("check");
    showToast("全链路验证完成");
  };

  const onReset = () => {
    setClauses(INITIAL_CLAUSES);
    setKnowledgeFiles([INITIAL_KNOWLEDGE_FILE]);
    setClauseAssetIds(Object.fromEntries(INITIAL_CLAUSES.map((clause) => [knowledgeClauseKey(clause), INITIAL_KNOWLEDGE_FILE.id])));
    knowledgeVectorBuildRunIds.current = {};
    setSignals([]);
    setSelectedSignalIndex(0);
    setPendingSlices([]);
    setKbRawText("");
    setKbFileName("");
    setKbFileSourceUrl("");
    setDraftText(DRAFT_SAMPLE);
    setDraftSlices(sliceDraftTextForReview(DRAFT_SAMPLE, "样例标准草案.txt"));
    setDraftSliceStatuses({});
    setDraftIssues(validateDraft(DRAFT_SAMPLE));
    setDraftSourceType("自动识别");
    setDraftFileName("样例标准草案.txt");
    setDraftFileInputKey((v) => v + 1);
    setDraftFileStatus(buildDraftValidationStatus("样例标准草案.txt", validateDraft(DRAFT_SAMPLE).length));
    setAgentTrace([]);
    setAgentThinkingTrace([]);
    setAgentTraceVisible(true);
    setCurrentMatch(null);
    setComparisonCount(0);
    setReportCount(0);
    setVerificationPointStatuses({});
    setFormattedReportText("");
    setBulkFile(null);
    setBulkSignals("");
    setBulkCandidates([]);
    setBulkParsing(false);
    setBulkFileStatus("文件状态：未选择文件。文本类文件可直接读取；Word、PDF、表格等由解析服务抽取正文。");
    navigate("overview");
    showToast("已重置");
  };

  const onCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(formattedReportText || reportText);
      showToast(formattedReportText ? "格式化报告已复制" : "报告摘要已复制");
    } catch {
      showToast("复制失败，请手动复制");
    }
  };

  const onConfirmVerificationPoint = (pointId: string, status: VerificationPointStatus) => {
    setVerificationPointStatuses((prev) => ({ ...prev, [pointId]: status }));
    setFormattedReportText("");
  };

  const onGenerateFormattedReport = () => {
    if (!allVerificationPointsConfirmed) {
      showToast("请先完成全部关键验证点确认");
      return;
    }
    setFormattedReportText(
      buildFormattedVerificationReport({
        draftFileName: draftFileName || "粘贴文本",
        match: effectiveMatch,
        points: verificationPoints,
        signals,
      })
    );
    setReportCount((v) => v + 1);
    showToast("格式化验证报告已生成");
  };

  const onDownloadFormattedReport = async () => {
    if (!formattedReportText) {
      showToast("请先生成格式化报告");
      return;
    }
    try {
      const response = await fetch("/api/report/export-docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportText: formattedReportText,
          title: `标准验证意见报告-${effectiveMatch.clause.id}`,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "报告文档导出失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `标准验证意见报告-${effectiveMatch.clause.id}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Word报告文档已导出");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "报告文档导出失败");
    }
  };

  const displayedAgentTrace: AgentExecutionLogLine[] =
    agentTrace.length
      ? agentTrace
      : [
          { time: "00:00", kind: "system", phase: "任务创建", message: "创建文本验证任务，绑定标准版本 GB/T 32168-2015。" },
          { time: "00:02", kind: "action", phase: "材料抽取", message: "抽取材料补正、线上线下一致、纸质材料重复提交等风险点。" },
          { time: "00:04", kind: "evidence", phase: "条款召回", message: "召回 4.1.1 一次性告知、4.1.2 线上线下一致。" },
          { time: "00:06", kind: "reasoning", phase: "规则推理", message: "判断“可供参考”弱化了强制性条款，建议进入人工复核。" },
          { time: "00:08", kind: "result", phase: "结果生成", message: "生成 3 条问题、2 条改写建议、1 份证据包。" },
        ];
  const displayedAgentThinkingTrace: AgentExecutionLogLine[] =
    agentThinkingTrace.length
      ? agentThinkingTrace
      : [
          { time: "00:00", kind: "system", phase: "命令接收", message: "用户命令：接收待验证文件，建立文本验证任务和执行上下文。" },
          { time: "00:02", kind: "reasoning", phase: "输入理解", message: "输入理解：识别文件来源、正文长度、条款表达和待校验范围。" },
          { time: "00:04", kind: "action", phase: "任务拆解", message: "任务拆解：拆成切片复核、规则校验、知识库召回、差异判断、验证点生成和报告组装。" },
          { time: "00:06", kind: "action", phase: "工具调用", message: "模拟工具调用：启动文本切片器、规则校验器和标准条款召回器。" },
          { time: "00:08", kind: "evidence", phase: "证据读取", message: "证据读取：读取命中条款、关键词、问题来源和相似度分值。" },
          { time: "00:10", kind: "reasoning", phase: "差异判断", message: "差异判断：综合文本问题、条款依据和置信度形成可审计结论。" },
          { time: "00:12", kind: "action", phase: "执行落地", message: "执行落地：生成关键验证点，等待专家逐项采纳意见或拒绝意见。" },
          { time: "00:14", kind: "result", phase: "结果输出", message: "结果输出：全部确认后生成格式化验证报告，并支持下载导出。" },
        ];
  const agentExecutionStarted = agentRunning || agentTrace.length > 0;
  const executionStepCards = buildAgentExecutionStepCards(displayedAgentTrace, {
    started: agentExecutionStarted,
    running: agentRunning,
  });
  const activeExecutionStep =
    executionStepCards.find((step) => step.status === "running") ||
    [...executionStepCards].reverse().find((step) => step.status === "done") ||
    executionStepCards[0];
  const completedExecutionStepCount = executionStepCards.filter((step) => step.status === "done").length;
  const executionProgress = Math.round(
    ((completedExecutionStepCount + (executionStepCards.some((step) => step.status === "running") ? 0.5 : 0)) /
      Math.max(1, executionStepCards.length)) *
      100
  );

  const dashboardWorkflowStats: Array<[string, string, string, string, AppView]> = [
    ["01 知识构建", `${clauses.length * 61 + 1} 条`, "PDF / Word 自动解析，按章节、条款、指标生成标准切片。", "from-white to-[#f2faff]", "knowledge"],
    ["02 舆情调研", `${signals.length * 7 + 1} 份`, "公开留言、热线样本、问卷访谈统一脱敏并映射事项。", "from-white to-[#f1fff9]", "signals"],
    ["03 文本验证", `${issueCount + 3} 项`, "术语、引用、编号、约束强度和可执行性规则协同校验。", "from-white to-[#fff7ef]", "check"],
    ["04 报告输出", `${Math.max(reportCount, 5)} 份`, "按结论、依据、风险、建议和复核状态生成专题报告。", "from-white to-[#fff0f6]", "report"],
  ];

  if (activeView === "check") {
    return (
      <div className="mx-auto max-w-[1460px] space-y-5">
        <Card className="gov-hero relative min-h-[260px] overflow-hidden p-8">
          <div className="max-w-[760px]">
            <h1 className="text-[38px] font-semibold leading-tight text-[#168df3]">随时随地验</h1>
            <h2 className="mt-2 text-[25px] font-semibold leading-tight text-[#0b315e]">政务服务标准智能验证工作台</h2>
            <p className="mt-6 max-w-[720px] text-[15px] leading-8 text-[#49657e]">
              面向公安政务服务标准，上传待验证文件后由智能体自动完成正文解析、条款召回、规则推理、证据匹配和报告生成。
            </p>
          </div>
          <div className="absolute right-8 top-8 hidden h-32 w-56 rotate-[-2deg] rounded-lg border border-[#bde6ff] bg-linear-to-br from-white/55 to-[#dff7ff]/75 shadow-sm xl:block" />
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <Button variant="outline" onClick={() => draftUploadInputRef.current?.click()}>
                <UploadCloud className="h-4 w-4" />
                上传待验证文件
              </Button>
              <input
                ref={draftUploadInputRef}
                className="hidden"
                type="file"
                accept=".txt,.md,.markdown,.html,.htm,.xml,.json,.csv,.tsv,.log,.doc,.docx,.pdf,.wps"
                onChange={(e) => onDraftFileChange(e.target.files?.[0])}
              />
              <div>
                <h2 className="text-[22px] font-semibold text-[#0b315e]">待验证文本切片展示区</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  待验证文本上传后先进行切片，形成切片列表。请人工复核确认切片无误后，再点击“开始文本验证”正式执行。
                </p>
              </div>
            </div>
            <Badge variant={allDraftSlicesConfirmed ? "success" : reviewedDraftSlices.length ? "warning" : "info"}>
              {reviewedDraftSlices.length ? `${confirmedDraftSliceCount}/${reviewedDraftSlices.length} 已确认` : "待上传"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d8e9f7] bg-[#fafdff] px-4 py-3 text-sm">
            <div className="text-muted-foreground">
              来源：<b className="text-[#0b315e]">{draftFileName || "待验证文件"}</b>
              <span className="mx-3 text-[#b9c9d9]">|</span>
              状态：{draftFileStatus}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => buildDraftSlicesForReview(draftText, draftFileName || "待验证文本")}>
                重新切片
              </Button>
              <Button variant="primary" onClick={onConfirmAllDraftSlices} disabled={!reviewedDraftSlices.length || allDraftSlicesConfirmed || !!editingDraftSliceId}>
                <CheckCircle2 className="h-4 w-4" />
                全部确认
              </Button>
            </div>
          </div>

          {reviewedDraftSlices.length ? (
            <div className="gov-scrollbar grid max-h-[420px] gap-3 overflow-auto pr-1 xl:grid-cols-2">
              {reviewedDraftSlices.map((slice) => (
                <div key={slice.id} className="rounded-lg border border-[#d8e9f7] bg-white/82 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingDraftSliceId === slice.id ? (
                        <Input value={editingDraftSliceTitle} onChange={(e) => setEditingDraftSliceTitle(e.target.value)} />
                      ) : (
                        <div className="text-sm font-semibold text-[#075ec9]">{slice.id} · {slice.title}</div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">{slice.charCount} 字 · {slice.sourceName}</div>
                    </div>
                    <Badge variant={slice.status === "confirmed" ? "success" : "warning"}>
                      {slice.status === "confirmed" ? "已确认" : "待确认"}
                    </Badge>
                  </div>
                  {editingDraftSliceId === slice.id ? (
                    <textarea
                      className="gov-input mt-3 min-h-32 w-full rounded-lg p-3 text-sm leading-7 outline-none"
                      value={editingDraftSliceText}
                      onChange={(e) => setEditingDraftSliceText(e.target.value)}
                    />
                  ) : (
                    <p className="mt-3 line-clamp-4 text-sm leading-7 text-[#14304f]">{slice.text}</p>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {editingDraftSliceId === slice.id ? (
                      <>
                        <Button variant="primary" onClick={() => onSaveDraftSliceEdit(slice.id)} disabled={!editingDraftSliceText.trim()}>
                          <Save className="h-4 w-4" />
                          保存校正
                        </Button>
                        <Button variant="ghost" onClick={onCancelEditDraftSlice}>
                          <XCircle className="h-4 w-4" />
                          取消
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="outline" onClick={() => onEditDraftSlice(slice)}>
                          <Pencil className="h-4 w-4" />
                          校正
                        </Button>
                        <Button variant="ghost" onClick={() => onRemoveDraftSlice(slice.id)}>
                          <Trash2 className="h-4 w-4" />
                          删除
                        </Button>
                        <Button variant={slice.status === "confirmed" ? "ghost" : "outline"} onClick={() => onConfirmDraftSlice(slice.id)}>
                          <CheckCircle2 className="h-4 w-4" />
                          确认切片无误
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#bde6ff] bg-white/72 p-6 text-center text-sm text-muted-foreground">
              请先上传待验证文件，系统会自动解析正文并生成待复核切片列表。
            </div>
          )}
        </Card>

        <section className="rounded-[14px] border border-[#d8e9f7] bg-white/94 p-5 shadow-[0_16px_40px_rgba(23,90,145,0.12)]">
          <div className="grid gap-4 border-b border-[#d8e9f7] pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${agentRunning ? "bg-[#168df3] shadow-[0_0_0_6px_rgba(22,141,243,0.12)]" : agentTrace.length ? "bg-[#13a875]" : "bg-[#8799aa]"}`} />
                <h2 className="text-xl font-semibold text-[#12304f]">智能体执行过程</h2>
                <Badge variant={agentRunning ? "warning" : agentTrace.length ? "success" : "warning"}>
                  {agentRunning ? "执行中" : agentTrace.length ? "已完成" : "待执行"}
                </Badge>
              </div>
              <div className="mt-3 grid max-w-[620px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="h-2 overflow-hidden rounded-full bg-[#e8f3fb]">
                  <div className="h-full rounded-full bg-linear-to-r from-[#168df3] to-[#16b89e] transition-all" style={{ width: `${executionProgress}%` }} />
                </div>
                <span className="text-xs font-semibold text-[#075ec9]">{completedExecutionStepCount} / {executionStepCards.length} 已完成 · {executionProgress}%</span>
              </div>
            </div>
            <Button variant="primary" onClick={onValidateDraft} disabled={agentRunning || !allDraftSlicesConfirmed || !!editingDraftSliceId}>
              {agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              开始文本验证
            </Button>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(360px,0.92fr)_minmax(420px,1.08fr)]">
            <div className="rounded-xl border border-[#d8e9f7] bg-[#f7fcff] p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-[#12304f]">执行步骤</h3>
                  <p className="mt-1 text-xs leading-5 text-[#5f7891]">已完成阶段折叠展示，当前阶段自动展开保留审计明细。</p>
                </div>
                <Badge variant={agentRunning ? "warning" : agentTrace.length ? "success" : "info"}>{agentRunning ? "运行中" : agentTrace.length ? "已归档" : "等待确认"}</Badge>
              </div>
              <div className="space-y-2">
                {executionStepCards.map((step, index) => (
                  <details
                    key={step.phase}
                    open={step.status === "running"}
                    className={`group rounded-lg border bg-white shadow-sm transition ${
                      step.status === "running"
                        ? "border-[#9ed0f5] shadow-[0_10px_22px_rgba(22,141,243,0.10)]"
                        : step.status === "done"
                          ? "border-[#ccecdf]"
                          : "border-[#d8e9f7]"
                    }`}
                  >
                    <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span
                        className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold ${
                          step.status === "done"
                            ? "border-[#bfe9d9] bg-[#eafaf5] text-[#13a875]"
                            : step.status === "running"
                              ? "border-[#b9def8] bg-[#edf8ff] text-[#168df3]"
                              : "border-[#c8dcec] bg-white text-[#8799aa]"
                        }`}
                      >
                        {step.status === "done" ? <CheckCircle2 className="h-4 w-4" /> : step.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#12304f]">{index + 1}. {step.phase}</span>
                        <span className="mt-1 block truncate text-xs leading-5 text-[#5f7891]">{step.summary}</span>
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          step.status === "done"
                            ? "bg-[#eafaf5] text-[#13a875]"
                            : step.status === "running"
                              ? "bg-[#edf8ff] text-[#075ec9]"
                              : "bg-[#eef3f7] text-[#62788e]"
                        }`}
                      >
                        {step.status === "done" ? "已完成" : step.status === "running" ? "执行中" : "待执行"}
                      </span>
                    </summary>
                    <div className="px-4 pb-4 pl-[58px]">
                      <div className="space-y-2 border-l-2 border-[#e6eef6] pl-3">
                        {step.subActions.length ? (
                          step.subActions.map((line, lineIndex) => (
                            <div key={`${step.phase}-${line.time}-${lineIndex}`} className="grid gap-2 text-xs leading-5 text-[#6f8295] md:grid-cols-[minmax(0,1fr)_auto]">
                              <span>
                                <b className="text-[#405a74]">{({ action: "执行", reasoning: "推理", evidence: "依据", result: "结果", system: "系统" } as const)[line.kind]}：</b>
                                {line.message}
                              </span>
                              <span className="font-mono text-[#a0adba]">{line.time}</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-[#8799aa]">等待上一阶段完成后写入明细。</div>
                        )}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#d8e9f7] bg-[#f7fcff] p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-[#12304f]">当前步骤明细</h3>
                  <p className="mt-1 text-xs leading-5 text-[#5f7891]">同步展示底层命令、任务拆解、工具调用和证据读取。</p>
                </div>
                <Badge variant={agentRunning ? "warning" : agentThinkingTrace.length ? "success" : "info"}>
                  {agentRunning ? "同步生成" : agentThinkingTrace.length ? "已记录" : "待执行"}
                </Badge>
              </div>

              <div className="rounded-lg border border-[#d8e9f7] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-semibold text-[#12304f]">{activeExecutionStep ? activeExecutionStep.phase : "等待执行"}</h4>
                  <Badge variant={activeExecutionStep?.status === "done" ? "success" : activeExecutionStep?.status === "running" ? "warning" : "info"}>
                    {activeExecutionStep?.status === "done" ? "已完成" : activeExecutionStep?.status === "running" ? "执行中" : "待执行"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#5f7891]">{activeExecutionStep?.summary || "请先确认切片后开始验证。"}</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                    <span className="block text-xs text-[#5f7891]">待验证切片</span>
                    <b className="mt-1 block text-lg text-[#075ec9]">{reviewedDraftSlices.length}</b>
                  </div>
                  <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                    <span className="block text-xs text-[#5f7891]">已确认切片</span>
                    <b className="mt-1 block text-lg text-[#075ec9]">{confirmedDraftSliceCount}</b>
                  </div>
                  <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                    <span className="block text-xs text-[#5f7891]">发现问题</span>
                    <b className="mt-1 block text-lg text-[#075ec9]">{issueCount}</b>
                  </div>
                </div>

                {activeExecutionStep?.phase === "舆情感知比对" && (
                  <div className="mt-3 grid gap-3 rounded-lg border border-[#cfe4f5] bg-[#fafdff] p-3 sm:grid-cols-3">
                    <div>
                      <span className="block text-xs text-[#5f7891]">召回样本</span>
                      <b className="mt-1 block text-lg text-[#0f9f8f]">{publicSentimentSupport.sampleCount}</b>
                    </div>
                    <div>
                      <span className="block text-xs text-[#5f7891]">问题标签</span>
                      <b className="mt-1 block text-sm text-[#14304f]">{publicSentimentSupport.issueTags.join("、") || "暂无标签"}</b>
                    </div>
                    <div>
                      <span className="block text-xs text-[#5f7891]">证据级别</span>
                      <b className="mt-1 block text-sm text-[#14304f]">{publicSentimentSupport.evidenceLevel}</b>
                    </div>
                    <p className="sm:col-span-3 text-xs leading-5 text-[#5f7891]">{publicSentimentSupport.boundaryNote}</p>
                  </div>
                )}

                <div className="gov-scrollbar mt-4 max-h-[360px] overflow-y-auto rounded-lg border border-[#dbeaf7] bg-[#fbfdff] p-3 text-xs leading-6 text-[#65788b]">
                  {displayedAgentThinkingTrace.map((line, index) => (
                    <div key={`${line.time}-${line.phase}-${index}`} className="grid gap-2 border-b border-[#e6eef6] py-2 last:border-b-0 md:grid-cols-[72px_72px_1fr]">
                      <span className="font-mono text-[#8799aa]">{line.time}</span>
                      <span className="w-fit rounded-full bg-[#edf8ff] px-2 py-0.5 text-[11px] font-semibold text-[#075ec9]">
                        {({ system: "接收", action: "执行", reasoning: "判断", evidence: "依据", result: "输出" } as const)[line.kind]}
                      </span>
                      <span className="text-[#49657e]">
                        <span className="mr-2 text-[#8799aa]">[{line.phase}]</span>
                        {line.message}
                      </span>
                    </div>
                  ))}
                  <div ref={agentThinkingEndRef} />
                  <div ref={agentLogEndRef} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {!!toast && <div className="fixed bottom-5 right-5 rounded-lg bg-[#07315d] px-4 py-2 text-sm text-white shadow-[0_18px_36px_rgba(7,49,93,0.24)]">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1560px] space-y-5">
      <Card className="gov-hero space-y-4 p-5 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-[#bde6ff] bg-white/75 px-3 py-1 text-xs font-semibold text-[#075ec9]">政务服务标准智能验证工作台</div>
            <h1 className="text-2xl font-semibold text-[#14304f] lg:text-3xl">随时随地验，标准依据一屏可查</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">两库一引擎一工作台一报告中心，支持条款级验证、知识切片、舆情调研、执行过程展示与报告输出。</p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button variant="outline" onClick={onRunAll}>
              <PlayCircle className="h-4 w-4" />
              运行全链路验证
            </Button>
            <Button variant="outline" onClick={onReset}>
              <RefreshCw className="h-4 w-4" />
              重置样例
            </Button>
          </div>
        </div>
      </Card>

      {activeView === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {dashboardWorkflowStats.map(([title, count, desc, gradient, view]) => (
              <button
                key={title}
                type="button"
                onClick={() => navigate(view)}
                className={`min-h-[150px] rounded-lg border border-[#d8e9f7] bg-linear-to-br ${gradient} p-5 text-left shadow-[0_12px_30px_rgba(24,131,219,0.07)] transition hover:-translate-y-0.5 hover:border-[#9bcdf4] hover:shadow-[0_18px_34px_rgba(24,131,219,0.14)] focus:outline-none focus:ring-2 focus:ring-[#168df3]/30`}
              >
                <div className="text-xs font-semibold text-muted-foreground">{title}</div>
                <div className="mt-3 text-2xl font-semibold text-[#0b315e]">{count}</div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{desc}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="gov-stat-card space-y-2"><div className="text-3xl font-semibold text-[#075ec9]">{clauses.length}</div><div className="text-sm font-medium text-muted-foreground">已切片标准条款</div></Card>
            <Card className="gov-stat-card space-y-2"><div className="text-3xl font-semibold text-[#0f9f8f]">{signals.length}</div><div className="text-sm font-medium text-muted-foreground">舆情与调研样本</div></Card>
            <Card className="gov-stat-card space-y-2"><div className="text-3xl font-semibold text-[#db8b16]">{comparisonCount}</div><div className="text-sm font-medium text-muted-foreground">累计比对次数</div></Card>
            <Card className="gov-stat-card space-y-2"><div className="text-3xl font-semibold text-[#d8466f]">{reportCount}</div><div className="text-sm font-medium text-muted-foreground">已生成比对报告</div></Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <h3 className="font-semibold">知识库切片分类</h3>
              <div className="mt-3 space-y-2 text-sm">
                {Object.entries(dimensionStats).map(([name, value]) => (
                  <div key={name} className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2">
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
                  <div key={name} className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2">
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
                  <div key={name} className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2">
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
                <div className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2"><span>当前条款置信度</span><b>{currentMatch ? `${currentMatch.score}%` : "待运行"}</b></div>
                <div className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2"><span>最高相似条款</span><b>{currentMatch ? currentMatch.clause.id : "待运行"}</b></div>
                <div className="gov-soft-panel flex items-center justify-between rounded-lg px-3 py-2"><span>比对报告数量</span><b>{reportCount} 份</b></div>
                <div className="gov-soft-panel rounded-lg px-3 py-2"><span className="text-muted-foreground">最近结论：</span>{currentMatch ? currentMatch.conclusion : "尚未运行条款比对"}</div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeView === "knowledge" && (
        <Card className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">标准知识库</h2>
            <Badge variant="info">条款级切片</Badge>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">目录清单联网获取</h3>
                  <p className="mt-1 text-xs text-muted-foreground">支持按文件名/标准号精确检索，也支持按模糊条件或缺失知识生成多个候选文件。</p>
                </div>
                <FileSearch className="h-5 w-5 text-[#168df3]" />
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#d8e9f7] bg-white/70 p-1">
                <button
                  type="button"
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${knowledgeSearchMode === "catalog" ? "bg-[#168df3] text-white shadow-sm" : "text-[#49657e] hover:bg-[#edf8ff]"}`}
                  onClick={() => setKnowledgeSearchMode("catalog")}
                >
                  标准号/标题检索
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${knowledgeSearchMode === "fuzzy" ? "bg-[#168df3] text-white shadow-sm" : "text-[#49657e] hover:bg-[#edf8ff]"}`}
                  onClick={() => setKnowledgeSearchMode("fuzzy")}
                >
                  模糊/缺失知识检索
                </button>
              </div>
              {knowledgeSearchMode === "catalog" ? (
                <textarea
                  className="gov-input min-h-28 w-full rounded-lg p-3 text-sm outline-none"
                  value={catalogInput}
                  onChange={(e) => setCatalogInput(e.target.value)}
                  placeholder="每行一个文件名称或标准号，例如：GBZ 24294.3-2017"
                />
              ) : (
                <div className="grid gap-2">
                  <Input value={fuzzyKnowledgeQuery} onChange={(e) => setFuzzyKnowledgeQuery(e.target.value)} placeholder="输入缺失知识或模糊条件，例如：地铁 政务服务 数据互通" />
                  <Input value={fuzzyKnowledgeRegion} onChange={(e) => setFuzzyKnowledgeRegion(e.target.value)} placeholder="适用地区，例如：杭州市、浙江省、全国" />
                  <p className="text-xs text-muted-foreground">将自动扩展为国家标准、行业标准、地方标准、政策文件、办事指南等多个候选文件。</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={onBuildCatalogSearchTasks}>
                  <Search className="h-4 w-4" />
                  {knowledgeSearchMode === "catalog" ? "生成联网检索任务" : "生成候选检索结果"}
                </Button>
              </div>
              {!!catalogTasks.length && (
                <div className="space-y-2">
                  {catalogTasks.map((task) => {
                    const isSearchingTask = task.status === "检索中";
                    const canAcquireTask = task.status === "已获取" && !task.message.includes("已加入知识文件列表");
                    return (
                    <div key={task.id} className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#0b315e]">{task.fileName}</span>
                            {task.candidateType ? <span className="rounded bg-[#e8f5ff] px-2 py-0.5 text-xs text-[#075ec9]">{task.candidateType}</span> : null}
                            {task.searchMode === "fuzzy" ? <span className="rounded bg-[#eafaf5] px-2 py-0.5 text-xs text-[#0f8f78]">多候选</span> : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{task.message}</p>
                        </div>
                        <Badge variant={task.status === "已获取" ? "success" : task.status === "检索中" ? "info" : "warning"}>{task.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => void onStartCatalogSearch(task)} disabled={isSearchingTask}>
                          {isSearchingTask ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          启动检索
                        </Button>
                        <Button variant="ghost" onClick={() => onAcquireCatalogTask(task)} disabled={!canAcquireTask}>
                          <FileText className="h-4 w-4" />
                          {task.message.includes("已加入知识文件列表") ? "已加入知识库" : "加入知识库"}
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">知识文件列表管理</h3>
                  <p className="mt-1 text-xs text-muted-foreground">管理上传和联网获取的知识文件，跟踪向量构建过程、访问次数和调用次数。</p>
                </div>
                <Badge variant="info">{knowledgeFiles.length} 个文件</Badge>
              </div>
              <div className="gov-scrollbar overflow-auto rounded-lg border border-[#d8e9f7] bg-white/80">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-[#edf8ff]">
                    <tr>
                      <th className="px-3 py-2">文件名称</th>
                      <th className="px-3 py-2">来源</th>
                      <th className="px-3 py-2">上传/获取时间</th>
                      <th className="px-3 py-2">向量构建进度</th>
                      <th className="px-3 py-2">切片</th>
                      <th className="px-3 py-2">访问/调用</th>
                      <th className="px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledgeFiles.map((file) => (
                      <tr key={file.id} className="border-t border-[#e4f0f8] align-top hover:bg-[#f7fcff]">
                        <td className="max-w-[260px] px-3 py-2">
                          <div className="font-medium text-[#0b315e]">{file.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">最近调用：{file.lastCalledAt || "暂无"}</div>
                        </td>
                        <td className="px-3 py-2">{file.sourceLabel}</td>
                        <td className="px-3 py-2 text-muted-foreground">{file.addedAt}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            title={file.vectorLogs.join("\n")}
                            className="w-full min-w-[180px] text-left"
                            onClick={() => onViewKnowledgeFile(file.id)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-[#075ec9]">{file.vectorStatus}</span>
                              <span className="text-xs text-muted-foreground">{file.vectorProgress}%</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e7f2fb]">
                              <div className="h-full rounded-full bg-linear-to-r from-[#168df3] to-[#0f9f8f]" style={{ width: `${file.vectorProgress}%` }} />
                            </div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Activity className="h-3 w-3" />
                              悬停或点击查看日志
                            </div>
                          </button>
                        </td>
                        <td className="px-3 py-2">{file.sliceCount}</td>
                        <td className="px-3 py-2">{file.accessCount} / {file.callCount}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button variant="ghost" onClick={() => onOpenKnowledgeFileSource(file)}>
                              <Eye className="h-4 w-4" />
                              查看原文
                            </Button>
                            <Button variant="outline" onClick={() => onAutoSliceKnowledgeFile(file.id)} disabled={file.sliceCount > 0}>
                              <FileSearch className="h-4 w-4" />
                              {file.sliceCount > 0 ? "已切分" : "自动切分"}
                            </Button>
                            <Button variant="outline" onClick={() => onBuildKnowledgeVector(file.id)}>
                              构建向量
                            </Button>
                            <Button variant="ghost" onClick={() => onRemoveKnowledgeFile(file.id)}>
                              <Trash2 className="h-4 w-4" />
                              移除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeKnowledgeLog && (
                <div className="rounded-lg border border-[#bde6ff] bg-[#f7fcff] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-[#0b315e]">{activeKnowledgeLog.name}</h4>
                      <p className="text-xs text-muted-foreground">向量构建完整日志</p>
                    </div>
                    <Button variant="ghost" onClick={() => setActiveKnowledgeLogId("")}>关闭</Button>
                  </div>
                  <div className="gov-scrollbar max-h-48 space-y-2 overflow-auto pr-1 text-sm">
                    {activeKnowledgeLog.vectorLogs.map((line, index) => (
                      <div key={`${activeKnowledgeLog.id}-${index}`} className="rounded-md border border-[#d8e9f7] bg-white px-3 py-2 text-[#14304f]">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="gov-soft-panel space-y-3 rounded-lg p-4">
            <h3 className="font-medium">知识库维护</h3>
            <div className="grid gap-2 lg:grid-cols-3">
              <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={kbSourceType} onChange={(e) => setKbSourceType(e.target.value)}>
                {["公安政务服务标准", "法律法规", "国家标准", "行业标准", "地方细则", "办事指南", "调研报告"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <Input placeholder="可上传 PDF/Word/文本文件或直接粘贴正文" readOnly />
              <input
                className="gov-file-input block h-9 w-full rounded-lg px-3 py-1 text-sm"
                type="file"
                accept=".txt,.md,.markdown,.html,.htm,.xml,.json,.csv,.doc,.docx,.pdf,.wps,.et,.dps"
                onChange={(e) => onKnowledgeFileChange(e.target.files?.[0])}
              />
            </div>
            <textarea
              className="gov-input min-h-32 w-full rounded-lg p-3 text-sm outline-none"
              value={kbRawText}
              onChange={(e) => {
                setKbRawText(e.target.value);
                setKbFileName("");
                setKbFileSourceUrl("");
                setPendingSlices([]);
                setKbParsing(false);
                setKbParseProgress(0);
                setKbParseStatus(buildKnowledgeParseProgressMessage(0));
                setKbSlicing(false);
                setKbSliceProgress(0);
                setKbSliceStatus(buildKnowledgeSliceProgressMessage(0));
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onAutoSliceKb} disabled={kbSlicing}>自动切分</Button>
              <Button variant="primary" onClick={onImportSlices} disabled={kbSlicing}>确认入库</Button>
              <Button variant="ghost" onClick={() => { setPendingSlices([]); setKbRawText(""); setKbFileName(""); setKbFileSourceUrl(""); setKbParsing(false); setKbParseProgress(0); setKbParseStatus(buildKnowledgeParseProgressMessage(0)); setKbSlicing(false); setKbSliceProgress(0); setKbSliceStatus(buildKnowledgeSliceProgressMessage(0)); setKbUploadStatus("维护状态：待上传或粘贴标准文本。"); }}>清空</Button>
            </div>
            <p className="text-xs text-muted-foreground">{kbUploadStatus}</p>
            {(kbParsing || kbParseProgress > 0) && (
              <div className="space-y-1.5 rounded-lg border border-[#d8e9f7] bg-white/72 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs text-[#49657e]">
                  <span>{kbParseStatus}</span>
                  <span className="font-semibold text-[#075ec9]">{kbParseProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e8f3fb]">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-[#168df3] to-[#8fc7ff] transition-all duration-300"
                    style={{ width: `${kbParseProgress}%` }}
                  />
                </div>
              </div>
            )}
            {(kbSlicing || kbSliceProgress > 0) && (
              <div className="space-y-1.5 rounded-lg border border-[#d8e9f7] bg-white/72 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs text-[#49657e]">
                  <span>{kbSliceStatus}</span>
                  <span className="font-semibold text-[#075ec9]">{kbSliceProgress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e8f3fb]">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-[#168df3] to-[#20c4a8] transition-all duration-300"
                    style={{ width: `${kbSliceProgress}%` }}
                  />
                </div>
              </div>
            )}
            {!!pendingSlices.length && (
              <div className="space-y-2">
                {pendingSlices.map((slice) => (
                   <div key={slice.id} className="rounded-lg border border-[#cfe4f5] bg-white/78 p-3 text-sm shadow-sm">
                    <b>{slice.id}</b> · {slice.dimension} · {slice.constraint}
                    <p className="mt-1 text-muted-foreground">{slice.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#d8e9f7] bg-white/80 p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#0b315e]">知识库向量区</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">所有“确认入库”的切片统一进入本区，完成向量构建后可检索、筛选、分页查看。</p>
              </div>
              <Badge variant="info">20 条 / 页</Badge>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <Input
                value={clauseSearch}
                onChange={(e) => {
                  setClauseSearch(e.target.value);
                  setKnowledgeVectorPage(1);
                }}
                placeholder="语义检索已构建向量条款，例如：材料补正一次性告知要求"
              />
              <select
                className="gov-input h-9 rounded-lg px-3 text-sm outline-none"
                value={clauseFilter}
                onChange={(e) => {
                  setClauseFilter(e.target.value);
                  setKnowledgeVectorPage(1);
                }}
              >
              {["全部", "流程", "材料", "资源", "安全", "评价"].map((item) => (
                <option key={item} value={item}>
                  {item === "全部" ? "全部维度" : item}
                </option>
              ))}
              </select>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                <span className="block text-xs text-muted-foreground">已入库文件</span>
                <b className="mt-1 block text-lg text-[#075ec9]">{completedVectorFileCount}</b>
              </div>
              <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                <span className="block text-xs text-muted-foreground">条款向量</span>
                <b className="mt-1 block text-lg text-[#075ec9]">{completedVectorClauseCount}</b>
              </div>
              <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                <span className="block text-xs text-muted-foreground">当前筛选</span>
                <b className="mt-1 block text-lg text-[#075ec9]">{filteredClauses.length}</b>
              </div>
              <div className="rounded-lg border border-[#d8e9f7] bg-[#fafdff] p-3">
                <span className="block text-xs text-muted-foreground">当前页</span>
                <b className="mt-1 block text-lg text-[#075ec9]">{pagedVectorClauses.page} / {pagedVectorClauses.pageCount}</b>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d8e9f7] bg-[#f7fcff] px-3 py-2 text-xs text-muted-foreground">
              <span>当前筛选显示：{pagedVectorClauses.start}-{pagedVectorClauses.end} 条 / 共 {pagedVectorClauses.total} 条</span>
              <span>所有切片入库后的知识库向量集中在此区域查看。</span>
            </div>

            <div className="gov-scrollbar mt-3 overflow-auto rounded-lg border border-[#d8e9f7] bg-white/80">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[#edf8ff]">
                  <tr>
                    <th className="px-3 py-2">条款 ID</th>
                    <th className="px-3 py-2">来源文件</th>
                    <th className="px-3 py-2">验证维度</th>
                    <th className="px-3 py-2">条款摘要</th>
                    <th className="px-3 py-2">约束</th>
                    <th className="px-3 py-2">向量状态</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVectorClauses.items.length ? (
                    pagedVectorClauses.items.map((clause) => (
                      <tr key={`${clause.source}-${clause.id}`} className="border-t border-[#e4f0f8] align-top hover:bg-[#f7fcff]">
                        <td className="px-3 py-2 font-medium text-[#0b315e]">{clause.id}</td>
                        <td className="px-3 py-2">{clause.source}</td>
                        <td className="px-3 py-2">{clause.dimension}</td>
                        <td className="px-3 py-2 text-muted-foreground">{clause.text}</td>
                        <td className="px-3 py-2">{clause.constraint}</td>
                        <td className="px-3 py-2"><Badge variant="success">已完成</Badge></td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-[#e4f0f8]">
                      <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={6}>
                        暂无符合条件的已构建向量条款。请确认知识文件向量进度已完成，或调整语义检索词和维度。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => setKnowledgeVectorPage((page) => page - 1)} disabled={pagedVectorClauses.page <= 1}>
                <ChevronLeft className="h-4 w-4" />
                上一页
              </Button>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: pagedVectorClauses.pageCount }, (_, index) => index + 1).map((page) => (
                  <Button
                    key={page}
                    variant={page === pagedVectorClauses.page ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setKnowledgeVectorPage(page)}
                  >
                    {page}
                  </Button>
                ))}
              </div>
              <Button variant="outline" onClick={() => setKnowledgeVectorPage((page) => page + 1)} disabled={pagedVectorClauses.page >= pagedVectorClauses.pageCount}>
                下一页
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {(activeView as string) === "check" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
          <Card className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">文本验证</h2>
              <p className="mt-1 text-sm text-muted-foreground">上传标准草案文档后，自动提取正文并进行格式、术语、逻辑和可执行性检查。</p>
            </div>
            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                支持 TXT、MD、HTML、CSV、JSON、XML、LOG、DOC、DOCX。PDF、WPS 可先提取正文后粘贴验证。
              </p>
              <div className="grid gap-2 lg:grid-cols-[1fr_1fr]">
                <select
                  className="gov-input h-9 rounded-lg px-3 text-sm outline-none"
                  value={draftSourceType}
                  onChange={(e) => setDraftSourceType(e.target.value)}
                >
                  {["自动识别", "标准草案", "办事指南", "政策条文", "调研材料"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <input
                  key={draftFileInputKey}
                  className="gov-file-input block h-9 w-full rounded-lg px-3 py-1 text-sm"
                  type="file"
                  accept=".txt,.md,.markdown,.html,.htm,.xml,.json,.csv,.tsv,.log,.doc,.docx,.pdf,.wps"
                  onChange={(e) => onDraftFileChange(e.target.files?.[0])}
                />
              </div>
              <textarea
                className="gov-input min-h-[260px] w-full rounded-lg p-3 text-sm outline-none"
                placeholder="也可以直接粘贴标准草案正文，点击“开始验证”。"
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  if (!draftFileName) setDraftFileName("粘贴文本");
                  setCurrentMatch(null);
                  setVerificationPointStatuses({});
                  setFormattedReportText("");
                }}
              />
              <p className="rounded-lg border border-[#d8e9f7] bg-white/72 px-3 py-2 text-xs text-muted-foreground">{draftFileStatus}</p>
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
                  setAgentThinkingTrace([]);
                  setCurrentMatch(null);
                  setVerificationPointStatuses({});
                  setFormattedReportText("");
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
                  setAgentThinkingTrace([]);
                  setCurrentMatch(null);
                  setVerificationPointStatuses({});
                  setFormattedReportText("");
                }}
              >
                清空
              </Button>
            </div>
          </Card>
          <Card className="space-y-4">
            <div className="gov-agent-window rounded-lg p-4 text-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">智能体执行窗口</h2>
                  <p className="mt-1 text-xs text-slate-400">左侧过程审计 · 右侧底层执行轨迹与工具动作</p>
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
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <div className="gov-scrollbar h-[420px] overflow-y-auto rounded-lg border border-slate-700/80 bg-black/28 p-3 font-mono text-[12px] leading-5">
                    <div className="mb-3 text-xs font-semibold text-slate-300">过程审计</div>
                    <div className="space-y-2">
                      {displayedAgentTrace.map((line, index) => (
                        <div key={`audit-${line.time}-${line.phase}-${index}`} className="grid gap-2 border-b border-slate-900/80 pb-2 last:border-b-0 md:grid-cols-[60px_64px_1fr]">
                          <span className="text-slate-500">{line.time}</span>
                          <span className="w-fit rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase text-blue-200">
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
                  </div>
                  <div className="gov-scrollbar h-[420px] overflow-y-auto rounded-lg border border-slate-700/80 bg-black/28 p-3 font-mono text-[12px] leading-5">
                    <div className="mb-3 text-xs font-semibold text-slate-300">思考与执行</div>
                    <div className="space-y-2">
                      {displayedAgentThinkingTrace.map((line, index) => (
                        <div key={`thinking-${line.time}-${line.phase}-${index}`} className="grid gap-2 border-b border-slate-900/80 pb-2 last:border-b-0 md:grid-cols-[60px_64px_1fr]">
                          <span className="text-slate-500">{line.time}</span>
                          <span className="w-fit rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase text-emerald-200">
                            {({ system: "接收", action: "执行", reasoning: "判断", evidence: "依据", result: "输出" } as const)[line.kind]}
                          </span>
                          <p className="break-words text-slate-300">
                            <span className="mr-2 text-slate-500">[{line.phase}]</span>
                            {line.message}
                          </p>
                        </div>
                      ))}
                      <div ref={agentThinkingEndRef} />
                    </div>
                  </div>
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
                  <div key={index} className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3 text-sm shadow-sm">
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      <Badge variant={level === "高" ? "danger" : level === "中" ? "warning" : "info"}>{level}</Badge>
                      {title}
                    </div>
                    <p className="text-muted-foreground">{detail}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3 text-sm text-muted-foreground">上传或粘贴正文后，点击“开始验证”查看问题清单和条款比对结果。</div>
              )}
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">比对结论</h2>
                <Badge variant={confidenceVariant(currentMatch?.score)}>{currentMatch ? `${currentMatch.score} 分` : "待验证"}</Badge>
              </div>
              {!currentMatch ? (
                <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3 text-sm text-muted-foreground">开始验证后，系统会自动匹配知识库中最相似的标准条款。</div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3"><b>数据库最相似条款：</b>{currentMatch.clause.id} {currentMatch.clause.text}</div>
                  <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3"><b>相似命中：</b>{currentMatch.overlap.length ? currentMatch.overlap.join("、") : "无明显关键词命中"}（相似度 {currentMatch.similarity}%）</div>
                  <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3">
                    <b>差异与风险：</b>
                    <ul className="ml-5 list-disc">
                      {currentMatch.issues.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-[#d8e9f7] bg-white/78 p-3"><b>比对结论：</b>{currentMatch.conclusion}</div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {activeView === "signals" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.1fr)]">
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">舆情与调研样本</h2>
              <div className="flex items-center gap-2">
                <Badge variant="info">{signals.length} 条</Badge>
                <Button type="button" variant="outline" size="sm" onClick={onClearSignalSamples} disabled={!signals.length && !bulkSignals && !bulkCandidates.length}>
                  <Trash2 className="h-3.5 w-3.5" />
                  清空样本
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {signals.map((signal, index) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={signal.id}
                  className={`w-full rounded-lg border px-3 py-3 text-left text-sm transition-all ${selectedSignalIndex === index ? "border-primary bg-[#edf8ff] shadow-[0_10px_24px_rgba(22,141,243,0.10)]" : "border-[#d8e9f7] bg-white/72 hover:bg-[#f7fcff]"}`}
                  onClick={() => setSelectedSignalIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedSignalIndex(index);
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{signal.id} · {signal.source} · {signal.region}</span>
                      {signal.evidenceStatus === "real_collected" && <Badge variant="success">真实采集</Badge>}
                    {signal.evidenceStatus === "imported" && <Badge variant="info">解析导入</Badge>}
                  </div>
                  <p className="mt-1 text-muted-foreground">{signal.text}</p>
                  {(signal.confidence || signal.matchedClauseId || signal.evaluationText) && (
                    <div className="mt-2 grid gap-1 rounded-md border border-[#d8e9f7] bg-white/70 p-2 text-xs text-[#49657e]">
                      {signal.confidence && <div><b>置信度：</b>{signal.confidence} 分</div>}
                      {signal.confidenceParts && (
                        <div>
                          <b>分项：</b>相关性 {signal.confidenceParts.relevance} / 完整性 {signal.confidenceParts.completeness} / 可比对性 {signal.confidenceParts.comparability} / 数据质量 {signal.confidenceParts.dataQuality}
                        </div>
                      )}
                      {signal.matchedClauseId && <div><b>命中条款：</b>{signal.matchedClauseSource} / {signal.matchedClauseId}</div>}
                      {signal.evaluationText && <div><b>评价数据：</b>{signal.evaluationText}</div>}
                    </div>
                  )}
                  {(signal.sourceUrl || signal.pageTitle || signal.publishedAt || signal.capturedAt) && (
                    <div className="mt-2 grid gap-1 rounded-md border border-[#d8e9f7] bg-white/70 p-2 text-xs text-[#49657e]">
                      {signal.pageTitle && <div><b>页面标题：</b>{signal.pageTitle}</div>}
                      {signal.publishedAt && <div><b>发布时间：</b>{signal.publishedAt}</div>}
                      {signal.capturedAt && <div><b>采集时间：</b>{signal.capturedAt}</div>}
                      {signal.sourceUrl && <div className="truncate"><b>来源 URL：</b>{signal.sourceUrl}</div>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {signal.sourceUrl && (
                          <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); window.open(signal.sourceUrl, "_blank", "noopener,noreferrer"); }}>
                            <ExternalLink className="h-3.5 w-3.5" />
                            来源页
                          </Button>
                        )}
                        {signal.snapshotUrl && (
                          <Button type="button" variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); window.open(signal.snapshotUrl, "_blank", "noopener,noreferrer"); }}>
                            <Eye className="h-3.5 w-3.5" />
                            快照
                          </Button>
                        )}
                      </div>
                      {signal.evidenceChain?.length ? (
                        <details className="pt-1" onClick={(event) => event.stopPropagation()}>
                          <summary className="cursor-pointer font-medium text-[#075ec9]">证据链 {signal.evidenceChain.length} 步</summary>
                          <div className="mt-1 space-y-1">
                            {signal.evidenceChain.map((item) => (
                              <div key={`${signal.id}-${item.stage}`} className="rounded bg-[#f7fcff] px-2 py-1">
                                {item.at} · {item.label}：{item.detail}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card className="space-y-4">
            <h2 className="text-lg font-semibold">样本接入中心</h2>
            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <h3 className="font-medium">数据检索引擎</h3>
              <div className="grid gap-2">
                <Input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} />
                <div className="grid gap-2 lg:grid-cols-2">
                  <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={searchScope} onChange={(e) => setSearchScope(e.target.value)}>
                    {["全网公开信息", "政府网站留言", "地方问政平台", "新闻资讯公开页", "社交媒体公开页"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={searchRegion} onChange={(e) => setSearchRegion(e.target.value)}>
                    {["杭州市", "临平区", "上城区", "拱墅区", "西湖区", "余杭区"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <Button variant="primary" onClick={onRunAiSearch} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  开始获取
                </Button>
                <div className="rounded-lg border border-[#cfe4f5] bg-white/72 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[#14304f]">检索网址维护</h4>
                    <Badge variant="info">{searchSites.length} 个网址</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {searchSites.length ? (
                      searchSites.map((site) => (
                        <div
                          key={site.id}
                          className={`grid gap-2 rounded-lg border p-2 text-xs md:grid-cols-[minmax(0,1fr)_auto] ${
                            activeSearchSiteId === site.id ? "border-[#168df3] bg-[#edf8ff]" : "border-[#d8e9f7] bg-white/80"
                          }`}
                        >
                          <button type="button" className="min-w-0 text-left" onClick={() => setActiveSearchSiteId(site.id)}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-[#14304f]">{site.name}</span>
                              <span className="rounded bg-[#e8f5ff] px-2 py-0.5 text-[#075ec9]">{site.category}</span>
                              {activeSearchSiteId === site.id && <span className="text-[#0f9f8f]">当前检索源</span>}
                            </div>
                            <div className="mt-1 truncate text-[#698198]">{site.url}</div>
                          </button>
                          <div className="flex gap-1 md:justify-end">
                            <Button type="button" variant="outline" size="sm" onClick={() => onOpenSearchSite(site)}>
                              <ExternalLink className="h-3.5 w-3.5" />
                              查看
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveSearchSite(site.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-[#cfe4f5] bg-white/70 p-3 text-xs text-muted-foreground">暂无维护网址，请添加后用于公开网络检索。</div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]">
                    <Input placeholder="网址名称" value={newSearchSiteName} onChange={(e) => setNewSearchSiteName(e.target.value)} />
                    <Input placeholder="https://..." value={newSearchSiteUrl} onChange={(e) => setNewSearchSiteUrl(e.target.value)} />
                    <Button type="button" variant="outline" onClick={onAddSearchSite}>添加维护</Button>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-linear-to-r from-[#168df3] to-[#0f9f8f] transition-all" style={{ width: `${searchProgress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{searchStatus}</p>
                <div className="gov-scrollbar max-h-40 overflow-auto rounded-lg border border-[#d8e9f7] bg-white/78 p-3 text-xs leading-5 text-[#49657e]">
                  {searchLog.map((line, index) => (
                    <div key={index}>{line}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <h3 className="font-medium">批量导入</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={bulkSource} onChange={(e) => setBulkSource(e.target.value)}>
                  {["问卷调研", "警小爱", "警察叔叔", "浙里办", "民呼我为", "12345 热线", "窗口评价", "政府网站留言", "专家座谈"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={bulkRegion} onChange={(e) => setBulkRegion(e.target.value)}>
                  {["杭州市", "临平区", "上城区", "拱墅区", "西湖区", "余杭区"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <input
                className="gov-file-input block h-9 w-full rounded-lg px-3 py-1 text-sm"
                type="file"
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.log,.doc,.docx,.pdf,.wps,.xls,.xlsx"
                onChange={(e) => onBulkFileChange(e.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">{bulkFileStatus}</p>
              <textarea className="gov-input min-h-28 w-full rounded-lg p-3 text-sm outline-none" value={bulkSignals} onChange={(e) => setBulkSignals(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={onParseBulkSignals} disabled={bulkParsing}>
                  {bulkParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
                  一键解析
                </Button>
                <Button variant="outline" onClick={onImportBulkSignals}>批量导入样本</Button>
              </div>
              {!!bulkCandidates.length && (
                <div className="space-y-2 rounded-lg border border-[#cfe4f5] bg-white/72 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-[#14304f]">解析候选样本</h4>
                    <Badge variant="success">{bulkCandidates.length} 条</Badge>
                  </div>
                  <div className="gov-scrollbar max-h-60 space-y-2 overflow-auto pr-1">
                    {bulkCandidates.map((candidate) => (
                      <div key={candidate.candidateId} className="rounded-lg border border-[#d8e9f7] bg-[#f7fcff] p-2 text-xs text-[#49657e]">
                        <div className="flex flex-wrap items-center gap-2 font-semibold text-[#14304f]">
                          <span>{candidate.candidateId}</span>
                          <Badge variant={candidate.confidence >= 85 ? "success" : candidate.confidence >= 70 ? "warning" : "danger"}>
                            {candidate.confidence} 分
                          </Badge>
                          <span>{candidate.matchedClauseId}</span>
                        </div>
                        <p className="mt-1 text-sm text-[#14304f]">{candidate.text}</p>
                        <div className="mt-1">
                          相关性 {candidate.confidenceParts.relevance} / 完整性 {candidate.confidenceParts.completeness} / 可比对性 {candidate.confidenceParts.comparability} / 数据质量 {candidate.confidenceParts.dataQuality}
                        </div>
                        <div className="mt-1">{candidate.evaluationText}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="gov-soft-panel space-y-3 rounded-lg p-4">
              <h3 className="font-medium">接口数据对接</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={interfacePlatform} onChange={(e) => setInterfacePlatform(e.target.value)}>
                  {Object.keys(INTERFACE_SAMPLES).map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select className="gov-input h-9 rounded-lg px-3 text-sm outline-none" value={interfaceDataType} onChange={(e) => setInterfaceDataType(e.target.value)}>
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.96fr)_minmax(420px,1.04fr)]">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">逐项关键验证点报告</h2>
                <p className="mt-1 text-sm text-muted-foreground">专家需对每个验证点选择采纳或拒绝，全部确认后才能生成正式报告。</p>
              </div>
              <Badge variant={allVerificationPointsConfirmed ? "success" : "warning"}>
                {confirmedVerificationCount}/{verificationPoints.length} 已确认
              </Badge>
            </div>

            <div className="space-y-3">
              {verificationPoints.map((point) => (
                <div key={point.id} className="rounded-lg border border-[#d8e9f7] bg-white/78 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#075ec9]">
                        <span>{point.id}</span>
                        <span className="text-[#9ab0c5]">|</span>
                        <span>{point.locator}</span>
                        <span className="text-[#9ab0c5]">|</span>
                        <span className={point.level === "高" ? "text-[#b42318]" : point.level === "中" ? "text-[#b76e00]" : "text-[#075ec9]"}>{point.riskLabel}</span>
                        <span className="text-[#9ab0c5]">|</span>
                        <span>{point.title}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={point.level === "高" ? "danger" : point.level === "中" ? "warning" : "info"}>{point.level}</Badge>
                        <span className="text-xs font-semibold text-muted-foreground">{point.category}</span>
                      </div>
                    </div>
                    <Badge variant={point.status === "accepted" ? "success" : point.status === "rejected" ? "danger" : "warning"}>
                      {point.status === "accepted" ? "采纳意见" : point.status === "rejected" ? "拒绝意见" : "待确认"}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2 text-sm leading-6 text-[#14304f]">
                    <p><b>原文定位：</b>{point.originalLocation}</p>
                    <p><b className="text-[#b42318]">问题判断：</b>{point.problemJudgment}</p>
                    <p><b>依据：</b>{point.references}</p>
                    <p><b>修改建议：</b>{point.revisionAdvice}</p>
                    <p><b>建议文本：</b>{point.suggestedText}</p>
                    <p><b>置信度：</b>{point.confidence} 分；<b>人工复核状态：</b>{point.reviewStatus}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant={point.status === "accepted" ? "primary" : "outline"} onClick={() => onConfirmVerificationPoint(point.id, "accepted")}>
                      <CheckCircle2 className="h-4 w-4" />
                      采纳意见
                    </Button>
                    <Button variant={point.status === "rejected" ? "primary" : "ghost"} onClick={() => onConfirmVerificationPoint(point.id, "rejected")}>
                      <XCircle className="h-4 w-4" />
                      拒绝意见
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-[#d8e9f7] bg-[#f7fcff] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[#14304f]">舆情样本向量区</h3>
                  <p className="mt-1 text-xs text-muted-foreground">按样本切片入库结果分页查看，每页 20 条，作为条款验证的辅助召回来源。</p>
                </div>
                <Badge variant="info">{pagedSignalVectors.total} 条</Badge>
              </div>
              {pagedSignalVectors.items.length ? (
                <>
                  <div className="mt-3 space-y-2">
                    {pagedSignalVectors.items.map((signal, index) => (
                      <div key={`signal-vector-${signal.id}`} className="rounded-md border border-[#d8e9f7] bg-white/78 p-2 text-xs leading-5 text-[#49657e]">
                        <div className="flex flex-wrap items-center gap-2 font-semibold text-[#14304f]">
                          <span>#{pagedSignalVectors.startIndex + index + 1}</span>
                          <span>{signal.source}</span>
                          <span className="text-[#9ab0c5]">|</span>
                          <span>{signal.type}</span>
                          {signal.matchedClauseId && <Badge variant="info">{signal.matchedClauseId}</Badge>}
                          <Badge variant="warning">辅助向量</Badge>
                        </div>
                        <p className="mt-1 text-[#14304f]">{signal.text}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[#698198]">
                          <span>地域：{signal.region}</span>
                          {signal.confidence && <span>置信度：{signal.confidence} 分</span>}
                          {signal.evidenceStatus && <span>来源状态：{signal.evidenceStatus === "real_collected" ? "真实采集" : signal.evidenceStatus === "imported" ? "解析导入" : "模拟样本"}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      第 {pagedSignalVectors.page} / {pagedSignalVectors.totalPages} 页 · 显示 {pagedSignalVectors.startIndex + 1}-{pagedSignalVectors.endIndex + 1}
                    </span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSignalVectorPage((page) => Math.max(1, page - 1))} disabled={pagedSignalVectors.page <= 1}>
                        <ChevronLeft className="h-3.5 w-3.5" />
                        上一页
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setSignalVectorPage((page) => Math.min(pagedSignalVectors.totalPages, page + 1))} disabled={pagedSignalVectors.page >= pagedSignalVectors.totalPages}>
                        下一页
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-[#cfe4f5] bg-white/70 p-3 text-xs text-muted-foreground">
                  暂无舆情样本向量。可通过公开检索、批量导入或接口同步形成辅助样本。
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">格式化验证报告文档</h2>
                <p className="mt-1 text-sm text-muted-foreground">确认完成后生成正式文本，并支持导出为 Word 可打开的文档。</p>
              </div>
              <Badge variant={formattedReportText ? "success" : allVerificationPointsConfirmed ? "info" : "warning"}>
                {formattedReportText ? "已生成" : allVerificationPointsConfirmed ? "可生成" : "待确认"}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onGenerateFormattedReport} disabled={!allVerificationPointsConfirmed}>
                生成格式化报告
              </Button>
              <Button variant="outline" onClick={onDownloadFormattedReport} disabled={!formattedReportText}>
                <Download className="h-4 w-4" />
                下载文档
              </Button>
              <Button variant="ghost" onClick={onCopyReport}>
                <Copy className="h-4 w-4" />
                复制内容
              </Button>
            </div>

            {!allVerificationPointsConfirmed && (
              <div className="rounded-lg border border-[#f4d48a] bg-[#fff8e8] p-3 text-sm leading-6 text-[#7a5200]">
                还有 {verificationPoints.length - confirmedVerificationCount} 个关键验证点未确认。全部选择“采纳意见”或“拒绝意见”后，系统会开放正式报告生成。
              </div>
            )}

            <div className="rounded-lg border border-[#d8e9f7] bg-[#f7fcff] p-4 text-sm leading-6 text-[#14304f]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">群众感知佐证（辅助依据）</h3>
                <Badge variant="info">{publicSentimentSupport.sampleCount} 条样本</Badge>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-[#d8e9f7] bg-white/72 p-2">
                  <span className="block text-xs text-muted-foreground">来源</span>
                  <b className="mt-1 block text-xs text-[#14304f]">{publicSentimentSupport.relatedSources.join("、") || "暂无来源"}</b>
                </div>
                <div className="rounded-md border border-[#d8e9f7] bg-white/72 p-2">
                  <span className="block text-xs text-muted-foreground">问题标签</span>
                  <b className="mt-1 block text-xs text-[#14304f]">{publicSentimentSupport.issueTags.join("、") || "暂无标签"}</b>
                </div>
                <div className="rounded-md border border-[#d8e9f7] bg-white/72 p-2">
                  <span className="block text-xs text-muted-foreground">证据级别</span>
                  <b className="mt-1 block text-xs text-[#14304f]">{publicSentimentSupport.evidenceLevel}</b>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">{publicSentimentSupport.summaries[0] || "暂无可用辅助样本。"}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{publicSentimentSupport.boundaryNote}</p>
            </div>

            <pre className="gov-scrollbar max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[#d8e9f7] bg-white/78 p-5 text-sm leading-7 text-[#14304f]">{formattedReportText || reportText}</pre>
          </Card>
        </div>
      )}

      {!!toast && <div className="fixed bottom-5 right-5 rounded-lg bg-[#07315d] px-4 py-2 text-sm text-white shadow-[0_18px_36px_rgba(7,49,93,0.24)]">{toast}</div>}
    </div>
  );
}

