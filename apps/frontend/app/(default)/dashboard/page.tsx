'use client';

import { SwissGrid } from '@/components/home/swiss-grid';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';
import { MasterResumeChoiceDialog } from '@/components/dashboard/master-resume-choice-dialog';
import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useTranslations } from '@/lib/i18n';

// Optimized Imports for Performance (No Barrel Imports)
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Settings from 'lucide-react/dist/esm/icons/settings';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';

import {
  fetchResume,
  fetchResumeList,
  deleteResume,
  retryProcessing,
  fetchJobDescription,
  setDefaultMasterResume,
  duplicateResume,
  MAX_MASTER_RESUMES,
  type ResumeListItem,
} from '@/lib/api/resume';
import { useStatusCache } from '@/lib/context/status-cache';
import { hasMeaningfulResumeContent } from '@/lib/utils/resume-content';

type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'loading';

export default function DashboardPage() {
  const { t, locale } = useTranslations();
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('loading');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [listError, setListError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  // One dialog for failed tile actions (set default, duplicate, re-upload default).
  const [actionError, setActionError] = useState<string | null>(null);
  const [tailoredResumes, setTailoredResumes] = useState<ResumeListItem[]>([]);
  const [otherMasters, setOtherMasters] = useState<ResumeListItem[]>([]);
  const [defaultMasterTitle, setDefaultMasterTitle] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isMasterChoiceDialogOpen, setIsMasterChoiceDialogOpen] = useState(false);
  // Set by "Delete and re-upload": the next completed upload replaces the deleted default.
  const [reuploadReplacesDefault, setReuploadReplacesDefault] = useState(false);
  const router = useRouter();

  // Status cache for optimistic counter updates and LLM status check
  const {
    status: systemStatus,
    isLoading: statusLoading,
    incrementResumes,
    decrementResumes,
    setHasMasterResume,
  } = useStatusCache();
  // Read through a ref so the list reconcile keeps a stable identity (it drives the load effects).
  const setHasMasterResumeRef = useRef(setHasMasterResume);
  useEffect(() => {
    setHasMasterResumeRef.current = setHasMasterResume;
  }, [setHasMasterResume]);

  // Request id guard for concurrent loadTailoredResumes invocations
  const loadRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef(0);
  const retryMasterRef = useRef<string | null>(null);
  const pollAttemptsRef = useRef(0);
  const otherMastersPollAttemptsRef = useRef(0);
  const [statusRevision, setStatusRevision] = useState(0);
  // Bumped when the latest list load ends without new data, so the extra-master poll it
  // superseded is rescheduled (a successful load re-arms it through `otherMasters`).
  const [listRevision, setListRevision] = useState(0);
  const activeMasterIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Lightweight in-memory cache for job snippets to avoid N+1 refetches
  const jobSnippetCacheRef = useRef<Record<string, string>>({});

  // Check if LLM is configured (API key is set)
  const isLlmConfigured = !statusLoading && systemStatus?.llm_configured;

  // Any ready master can be tailored (the tailor page picks the default, else the
  // stored id, else the first ready one), so a failed default must not block the rest.
  const hasReadyMaster =
    processingStatus === 'ready' || otherMasters.some((r) => r.processing_status === 'ready');
  const isTailorEnabled = Boolean(masterResumeId) && hasReadyMaster && isLlmConfigured;

  const formatDate = (value: string) => {
    if (!value) return t('common.unknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('common.unknown');

    // Intl resolves plain language tags itself; the old ternary silently sent
    // ko/fr/pt to en-US. Every other call site already passes `locale` directly.
    return date.toLocaleDateString(locale, {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const adoptMasterResume = useCallback((resumeId: string | null) => {
    if (activeMasterIdRef.current !== resumeId) {
      statusRequestIdRef.current += 1;
      retryMasterRef.current = null;
      pollAttemptsRef.current = 0;
      setIsRetrying(false);
    }
    activeMasterIdRef.current = resumeId;
    setMasterResumeId(resumeId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
      statusRequestIdRef.current += 1;
    };
  }, []);

  const checkResumeStatus = useCallback(
    async (resumeId: string, background = false) => {
      if (
        !mountedRef.current ||
        activeMasterIdRef.current !== resumeId ||
        retryMasterRef.current === resumeId
      )
        return;
      if (!background) pollAttemptsRef.current = 0;
      const requestId = ++statusRequestIdRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        requestId === statusRequestIdRef.current &&
        activeMasterIdRef.current === resumeId;
      try {
        if (!background) setProcessingStatus('loading');
        const data = await fetchResume(resumeId);
        if (!isCurrent()) return;
        const savedStatus = data.raw_resume?.processing_status || 'pending';
        // Older backend versions accepted `{}` as a valid ResumeData object.
        // Surface that legacy state as failed so users can retry it safely.
        const status =
          savedStatus === 'ready' && !hasMeaningfulResumeContent(data.processed_resume)
            ? 'failed'
            : savedStatus;
        setProcessingStatus(status as ProcessingStatus);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        console.error('Failed to check resume status:', err);
        // If resume not found (404), clear the stale localStorage
        if (err instanceof Error && err.message.includes('404')) {
          localStorage.removeItem('master_resume_id');
          adoptMasterResume(null);
          return;
        }
        setProcessingStatus('failed');
      } finally {
        if (isCurrent()) setStatusRevision((version) => version + 1);
      }
    },
    [adoptMasterResume]
  );

  useEffect(() => {
    const storedId = localStorage.getItem('master_resume_id');
    if (storedId) {
      adoptMasterResume(storedId);
      checkResumeStatus(storedId);
    }
  }, [adoptMasterResume, checkResumeStatus]);

  // A bounded backoff preserves the processing label and never overlaps requests.
  // Focus or an explicit refresh starts a fresh observation window.
  useEffect(() => {
    if (
      !masterResumeId ||
      isRetrying ||
      !['pending', 'processing'].includes(processingStatus) ||
      pollAttemptsRef.current >= 12
    )
      return;
    const requestId = statusRequestIdRef.current;
    const delay = Math.min(30_000, 3_000 * 2 ** pollAttemptsRef.current);
    const timer = window.setTimeout(() => {
      if (requestId !== statusRequestIdRef.current || document.hidden) return;
      pollAttemptsRef.current += 1;
      void checkResumeStatus(masterResumeId, true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [masterResumeId, processingStatus, isRetrying, statusRevision, checkResumeStatus]);

  // `background` marks a poll-driven refresh: it must not reset the default master's
  // observation window or flash its status back to "checking".
  const loadTailoredResumes = useCallback(
    async (background = false) => {
      const requestId = ++loadRequestIdRef.current;
      const isCurrent = () => mountedRef.current && requestId === loadRequestIdRef.current;
      try {
        setListError(false);
        const data = await fetchResumeList(true);
        if (!isCurrent()) return;
        const masters = data.filter((r) => r.is_master);
        // Server truth for the shared flag Settings reads; other pages can leave it stale.
        setHasMasterResumeRef.current(masters.length > 0);
        const masterFromList = masters.find((r) => r.is_default_master) ?? masters[0];
        const storedId = localStorage.getItem('master_resume_id');
        const resolvedMasterId = masterFromList?.resume_id || storedId;

        if (resolvedMasterId) {
          const sameMaster = activeMasterIdRef.current === resolvedMasterId;
          localStorage.setItem('master_resume_id', resolvedMasterId);
          adoptMasterResume(resolvedMasterId);
          checkResumeStatus(resolvedMasterId, background && sameMaster);
        } else {
          localStorage.removeItem('master_resume_id');
          adoptMasterResume(null);
        }

        setOtherMasters(masters.filter((r) => r.resume_id !== resolvedMasterId));
        setDefaultMasterTitle(masterFromList?.title ?? null);
        const filtered = data.filter((r) => !r.is_master && r.resume_id !== resolvedMasterId);
        setTailoredResumes(filtered);

        // Only fetch job descriptions for resumes that are actually tailored
        // (identified by having a non-null parent_id). This avoids N+1 calls
        // for untailored resumes.
        const tailoredWithParent = filtered.filter((r) => r.parent_id);

        // Fetch job description snippets for tailored resumes in parallel and attach to state
        // Use a small in-memory cache to avoid re-fetching the same snippet repeatedly.
        const jobSnippets: Record<string, string> = {};
        await Promise.all(
          tailoredWithParent.map(async (r) => {
            // Use cached snippet when available
            if (jobSnippetCacheRef.current[r.resume_id]) {
              jobSnippets[r.resume_id] = jobSnippetCacheRef.current[r.resume_id];
              return;
            }
            try {
              const jd = await fetchJobDescription(r.resume_id);
              const snippet = (jd?.content || '').slice(0, 80);
              if (isCurrent()) jobSnippetCacheRef.current[r.resume_id] = snippet;
              jobSnippets[r.resume_id] = snippet;
            } catch {
              // ignore missing job descriptions and cache empty result
              if (isCurrent()) jobSnippetCacheRef.current[r.resume_id] = '';
              jobSnippets[r.resume_id] = '';
            }
          })
        );

        // Only apply results if this invocation is the latest (prevents stale overwrite)
        if (isCurrent()) {
          setTailoredResumes((prev) =>
            prev.map((r) => ({ ...r, jobSnippet: jobSnippets[r.resume_id] || '' }))
          );
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('Failed to load tailored resumes:', err);
        setListError(true);
        setListRevision((version) => version + 1);
      }
    },
    [adoptMasterResume, checkResumeStatus]
  );

  // Extra masters parse in the background; refresh the list with the same bounded
  // backoff as the default master until none is pending or processing.
  useEffect(() => {
    const isParsing = otherMasters.some((r) =>
      ['pending', 'processing'].includes(r.processing_status)
    );
    if (!isParsing) {
      otherMastersPollAttemptsRef.current = 0;
      return;
    }
    if (otherMastersPollAttemptsRef.current >= 12) return;
    // A reload started after scheduling (focus, upload, an action) supersedes this
    // poll; the list it loads, or `listRevision` when it fails, re-runs this effect.
    const requestId = loadRequestIdRef.current;
    const delay = Math.min(30_000, 3_000 * 2 ** otherMastersPollAttemptsRef.current);
    const timer = window.setTimeout(() => {
      if (requestId !== loadRequestIdRef.current || document.hidden) return;
      otherMastersPollAttemptsRef.current += 1;
      void loadTailoredResumes(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [otherMasters, listRevision, loadTailoredResumes]);

  useEffect(() => {
    loadTailoredResumes();
  }, [loadTailoredResumes]);

  // Refresh list when window gains focus (e.g., returning from viewer after delete)
  useEffect(() => {
    const handleFocus = () => {
      otherMastersPollAttemptsRef.current = 0;
      loadTailoredResumes();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadTailoredResumes, checkResumeStatus]);

  const handleUploadComplete = (resumeId: string) => {
    // Update cached counters
    incrementResumes();
    setHasMasterResume(true);
    if (reuploadReplacesDefault) {
      setReuploadReplacesDefault(false);
      otherMastersPollAttemptsRef.current = 0;
      void makeReuploadDefault(resumeId);
      return;
    }
    // Only the first upload becomes the default; later ones join the other masters
    if (!masterResumeId) {
      localStorage.setItem('master_resume_id', resumeId);
      adoptMasterResume(resumeId);
      // Check status after upload completes
      checkResumeStatus(resumeId);
    }
    otherMastersPollAttemptsRef.current = 0;
    void loadTailoredResumes();
  };

  // Deleting the old default promoted another track on the server, so the
  // re-upload takes the default explicitly. The list reload shows it either way.
  const makeReuploadDefault = async (resumeId: string) => {
    try {
      await setDefaultMasterResume(resumeId);
      localStorage.setItem('master_resume_id', resumeId);
    } catch (err) {
      console.error('Failed to set the re-uploaded resume as default:', err);
      // Close the upload dialog (still showing success until its 1.5 s auto-close) in the
      // same render, so the error never stacks on it or loses the scroll lock when it closes.
      setIsUploadDialogOpen(false);
      setActionError(t('resumeViewer.setDefaultError'));
    }
    await loadTailoredResumes();
  };

  const handleUploadDialogOpenChange = (open: boolean) => {
    setIsUploadDialogOpen(open);
    // A re-upload dialog closed without an upload ends the replacement.
    if (!open) setReuploadReplacesDefault(false);
  };

  const handleSetDefault = async (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    try {
      await setDefaultMasterResume(resumeId);
      localStorage.setItem('master_resume_id', resumeId);
      await loadTailoredResumes();
    } catch (err) {
      console.error('Failed to set default master resume:', err);
      setActionError(t('resumeViewer.setDefaultError'));
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    setIsDuplicating(true);
    try {
      await duplicateResume(resumeId);
      incrementResumes();
      await loadTailoredResumes();
    } catch (err) {
      console.error('Failed to duplicate resume:', err);
      // A 409 (master limit, not ready) carries a message written for the user.
      const isConflict = (err as { status?: number } | null)?.status === 409;
      setActionError(
        isConflict && err instanceof Error ? err.message : t('resumeViewer.duplicateError')
      );
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleChooseUpload = () => {
    setIsMasterChoiceDialogOpen(false);
    setIsUploadDialogOpen(true);
  };

  const handleChooseWizard = () => {
    setIsMasterChoiceDialogOpen(false);
    router.push('/resume-wizard');
  };

  const handleInitializeMasterKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsMasterChoiceDialogOpen(true);
    }
  };

  const handleRetryProcessing = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!masterResumeId || retryMasterRef.current === masterResumeId) return;
    const resumeId = masterResumeId;
    retryMasterRef.current = resumeId;
    const requestId = ++statusRequestIdRef.current;
    const isCurrent = () =>
      mountedRef.current &&
      requestId === statusRequestIdRef.current &&
      activeMasterIdRef.current === resumeId;
    setIsRetrying(true);
    setProcessingStatus('loading');
    try {
      const result = await retryProcessing(resumeId);
      if (!isCurrent()) return;
      if (result.processing_status === 'ready') {
        setProcessingStatus('ready');
      } else if (
        result.processing_status === 'processing' ||
        result.processing_status === 'pending'
      ) {
        pollAttemptsRef.current = 0;
        setProcessingStatus(result.processing_status);
      } else {
        setProcessingStatus('failed');
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Retry processing failed:', err);
      if (err instanceof Error && err.message.includes('status 404')) {
        localStorage.removeItem('master_resume_id');
        adoptMasterResume(null);
        setHasMasterResume(false);
        return;
      }
      setProcessingStatus('failed');
    } finally {
      if (isCurrent()) {
        retryMasterRef.current = null;
        setIsRetrying(false);
      }
    }
  };

  const handleDeleteAndReupload = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const confirmDeleteAndReupload = async () => {
    if (!masterResumeId) return;
    const resumeId = masterResumeId;
    const invalidationId = ++loadRequestIdRef.current;
    try {
      setDeleteError(false);
      await deleteResume(resumeId);
      if (!mountedRef.current || activeMasterIdRef.current !== resumeId) return;
      decrementResumes();
      // The server promotes a remaining master, so the flag only clears with the last one.
      setHasMasterResume(otherMasters.length > 0);
      localStorage.removeItem('master_resume_id');
      adoptMasterResume(null);
      setProcessingStatus('loading');
      setReuploadReplacesDefault(true);
      setIsUploadDialogOpen(true);
      await loadTailoredResumes();
    } catch (err) {
      if (!mountedRef.current || activeMasterIdRef.current !== resumeId) return;
      console.error('Failed to delete resume:', err);
      setShowDeleteDialog(false);
      setDeleteError(true);
    } finally {
      // No reload followed (the delete failed or the master changed): re-arm the poll.
      if (mountedRef.current && invalidationId === loadRequestIdRef.current) {
        setListRevision((version) => version + 1);
      }
    }
  };

  const getStatusDisplay = () => {
    switch (processingStatus) {
      case 'loading':
        return {
          text: t('dashboard.status.checking'),
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          color: 'text-steel-grey',
        };
      case 'processing':
        return {
          text: t('dashboard.status.processing'),
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          color: 'text-blue-700',
        };
      case 'ready':
        return { text: t('dashboard.status.ready'), icon: null, color: 'text-green-700' };
      case 'failed':
        return {
          text: t('dashboard.status.failed'),
          icon: <AlertCircle className="w-3 h-3" />,
          color: 'text-red-600',
        };
      default:
        return { text: t('dashboard.status.pending'), icon: null, color: 'text-steel-grey' };
    }
  };

  const getMonogram = (title: string): string => {
    const words = title.split(/\s+/).filter((w) => /^[a-zA-Z]/.test(w));
    return words
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  };

  // Muted palette that complements the #F0F0E8 canvas
  const cardPalette = [
    { bg: '#1D4ED8', fg: '#FFFFFF' }, // Hyper Blue
    { bg: '#15803D', fg: '#FFFFFF' }, // Signal Green
    { bg: '#000000', fg: '#FFFFFF' }, // Ink
    { bg: '#92400E', fg: '#FFFFFF' }, // Warm Brown
    { bg: '#7C3AED', fg: '#FFFFFF' }, // Violet
    { bg: '#0E7490', fg: '#FFFFFF' }, // Teal
    { bg: '#B91C1C', fg: '#FFFFFF' }, // Deep Red
    { bg: '#4338CA', fg: '#FFFFFF' }, // Indigo
  ];

  const hashTitle = (title: string): number => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  };

  const atMasterLimit = 1 + otherMasters.length >= MAX_MASTER_RESUMES;
  const showAddTrackTile = Boolean(masterResumeId) && !atMasterLimit && isLlmConfigured;

  const listErrorAlert = listError ? (
    <div
      role="alert"
      className="m-6 rounded-none border-2 border-red-600 bg-red-100 p-6 shadow-sw-default"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p className="font-mono text-sm font-bold uppercase text-red-600">
            {t('dashboard.errors.loadFailed')}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void loadTailoredResumes()}>
            <RefreshCw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
        </div>
      </div>
    </div>
  ) : null;
  if (listError && !masterResumeId && otherMasters.length === 0 && tailoredResumes.length === 0)
    return listErrorAlert;

  return (
    <div className="space-y-6">
      {listErrorAlert}
      {/* Configuration Warning Banner */}
      {masterResumeId && !isLlmConfigured && !statusLoading && (
        <div className="border-2 border-warning bg-amber-50 p-4 shadow-sw-default mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <div>
              <p className="font-mono text-sm font-bold uppercase tracking-wider text-amber-800">
                {t('dashboard.llmNotConfiguredTitle')}
              </p>
              <p className="font-mono text-xs text-amber-700 mt-0.5">
                {t('dashboard.llmNotConfiguredMessage')}
              </p>
            </div>
          </div>
          <Link href="/settings">
            <Button variant="outline" size="sm" className="border-warning text-amber-700">
              <Settings className="w-4 h-4 mr-2" />
              {t('nav.settings')}
            </Button>
          </Link>
        </div>
      )}

      <SwissGrid>
        {/* 1. Master Resume Logic */}
        {!masterResumeId ? (
          // LLM Not Configured or Upload State
          !isLlmConfigured && !statusLoading ? (
            <Link href="/settings" className="block h-full">
              <Card
                variant="interactive"
                className="min-h-[220px] h-full border-dashed border-amber-300 bg-amber-50/50 hover:bg-amber-50/80 hover:border-amber-400 p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 text-amber-700 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <CardTitle className="text-base font-semibold text-amber-900 mb-2">
                    {t('dashboard.setupRequiredTitle')}
                  </CardTitle>
                  <CardDescription className="text-amber-700 text-xs leading-relaxed">
                    {t('dashboard.setupRequiredMessage')}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 text-amber-800 font-medium text-xs pt-4">
                  <Settings className="w-4 h-4" />
                  <span>{t('nav.goToSettings')} &rarr;</span>
                </div>
              </Card>
            </Link>
          ) : (
            <Card
              variant="interactive"
              className="min-h-[220px] h-full border-2 border-dashed border-primary/30 hover:border-primary hover:bg-primary/[0.03] p-6 flex flex-col justify-between transition-all"
              role="button"
              tabIndex={0}
              aria-label={t('dashboard.initializeMasterResume')}
              onClick={() => setIsMasterChoiceDialogOpen(true)}
              onKeyDown={handleInitializeMasterKeyDown}
            >
              <div>
                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
                  <Plus className="w-6 h-6" />
                </div>
                <CardTitle className="text-base font-semibold text-slate-900 group-hover:text-primary transition-colors">
                  {t('dashboard.initializeMasterResume')}
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {t('dashboard.initializeSequence')}
                </CardDescription>
              </div>
              <p className="text-xs font-semibold text-primary pt-4 flex items-center gap-1">
                + {t('dashboard.initializeMasterResume')} &rarr;
              </p>
            </Card>
          )
        ) : (
          // Master Resume Exists
          <Card
            variant="interactive"
            className="min-h-[220px] h-full p-6 flex flex-col justify-between border-slate-200/90 hover:border-primary/40"
            onClick={() => router.push(`/resumes/${masterResumeId}`)}
          >
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="w-11 h-11 rounded-xl bg-primary text-white flex items-center justify-center font-bold text-base shadow-sm">
                  M
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-sans text-[11px] font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                    {t('dashboard.defaultBadge')}
                  </span>
                  {(processingStatus === 'failed' || processingStatus === 'processing') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-blue-100 hover:text-blue-700 rounded-lg relative z-10"
                      onClick={handleRetryProcessing}
                      disabled={isRetrying}
                      aria-label={t('dashboard.retryProcessing')}
                      title={t('dashboard.retryProcessing')}
                    >
                      {isRetrying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <CardTitle className="text-base font-semibold text-slate-900 line-clamp-2 group-hover:text-primary transition-colors">
                  {defaultMasterTitle || t('dashboard.masterResume')}
                </CardTitle>
                <p className="text-xs text-slate-500 mt-1 font-sans">
                  {t('dashboard.masterTrack')}
                </p>
              </div>

              <div
                className={`text-xs mt-auto pt-4 flex flex-col gap-2 font-medium uppercase ${getStatusDisplay().color}`}
              >
                <div className="flex items-center gap-1.5">
                  {getStatusDisplay().icon}
                  <span>{t('dashboard.statusLine', { status: getStatusDisplay().text })}</span>
                </div>
                {(processingStatus === 'failed' || processingStatus === 'processing') && (
                  <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={handleRetryProcessing}
                      disabled={isRetrying}
                    >
                      {isRetrying
                        ? t('dashboard.retryingProcessing')
                        : t('dashboard.retryProcessing')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 border-red-200 text-red-600 hover:bg-red-50"
                      onClick={handleDeleteAndReupload}
                    >
                      {t('dashboard.deleteAndReupload')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* 2. Other Master Resumes */}
        {otherMasters.map((resume) => {
          const title = resume.title || resume.filename || t('dashboard.masterTrack');
          return (
            <Card
              key={resume.resume_id}
              variant="interactive"
              className="min-h-[220px] h-full p-6 flex flex-col justify-between border-slate-200/90"
              onClick={() => router.push(`/resumes/${resume.resume_id}`)}
            >
              <div className="flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-11 h-11 rounded-xl bg-slate-800 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                    M
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 uppercase bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                    {resume.processing_status}
                  </span>
                </div>
                <CardTitle className="text-base font-semibold text-slate-900 line-clamp-2">
                  {title}
                </CardTitle>
                <div className="mt-auto pt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    aria-label={t('dashboard.setDefault')}
                    onClick={(e) => handleSetDefault(e, resume.resume_id)}
                  >
                    {t('dashboard.setDefault')}
                  </Button>
                  {!atMasterLimit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      aria-label={t('dashboard.duplicate')}
                      disabled={isDuplicating || resume.processing_status !== 'ready'}
                      onClick={(e) => handleDuplicate(e, resume.resume_id)}
                    >
                      {t('dashboard.duplicate')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}

        {/* 3. Add Master Track */}
        {showAddTrackTile && (
          <Card
            variant="interactive"
            className="min-h-[220px] h-full p-6 border-2 border-dashed border-slate-200 hover:border-primary/50 hover:bg-primary/[0.02] flex flex-col justify-between transition-all"
            role="button"
            tabIndex={0}
            aria-label={t('dashboard.addMasterTrack')}
            onClick={() => setIsMasterChoiceDialogOpen(true)}
            onKeyDown={handleInitializeMasterKeyDown}
          >
            <div className="flex-1 flex flex-col justify-between pointer-events-none">
              <div>
                <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center mb-4 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  <Plus className="w-5 h-5" />
                </div>
                <CardTitle className="text-base font-semibold text-slate-900 group-hover:text-primary transition-colors">
                  {t('dashboard.addMasterTrack')}
                </CardTitle>
                <CardDescription className="text-xs text-slate-500 mt-1">
                  {t('dashboard.masterLimitReached', { max: MAX_MASTER_RESUMES })}
                </CardDescription>
              </div>
              <p className="text-xs font-semibold text-primary pt-4 flex items-center gap-1">
                + {t('dashboard.addMasterTrack')} &rarr;
              </p>
            </div>
          </Card>
        )}

        {/* 4. Tailored Resumes */}
        {tailoredResumes.map((resume) => {
          const title =
            resume.title || resume.jobSnippet || resume.filename || t('dashboard.tailoredResume');
          const color = cardPalette[hashTitle(title) % cardPalette.length];
          return (
            <Card
              key={resume.resume_id}
              variant="interactive"
              className="min-h-[220px] h-full p-6 flex flex-col justify-between border-slate-200/90 hover:border-primary/40"
              onClick={() => router.push(`/resumes/${resume.resume_id}`)}
            >
              <div className="flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow-sm border border-black/10"
                    style={{ backgroundColor: color.bg, color: color.fg }}
                  >
                    {getMonogram(title)}
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 uppercase bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                    {resume.processing_status}
                  </span>
                </div>
                <CardTitle className="text-base font-semibold text-slate-900 line-clamp-2 group-hover:text-primary transition-colors">
                  {title}
                </CardTitle>
                <CardDescription className="mt-auto pt-4 text-xs text-slate-500 font-sans">
                  {t('dashboard.edited', {
                    date: formatDate(resume.updated_at || resume.created_at),
                  })}
                </CardDescription>
              </div>
            </Card>
          );
        })}

        {/* 5. Create Tailored Resume */}
        <Card
          variant={isTailorEnabled ? 'interactive' : 'default'}
          className={cn(
            'min-h-[220px] h-full p-6 flex flex-col justify-between border-2 border-dashed transition-all',
            isTailorEnabled
              ? 'border-primary/40 hover:border-primary hover:bg-primary/[0.03] cursor-pointer group'
              : 'border-slate-200/90 bg-slate-50/50 opacity-80 cursor-not-allowed'
          )}
          role={isTailorEnabled ? 'button' : undefined}
          tabIndex={isTailorEnabled ? 0 : -1}
          onClick={() => {
            if (isTailorEnabled) {
              router.push('/tailor');
            }
          }}
          onKeyDown={(e) => {
            if (isTailorEnabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              router.push('/tailor');
            }
          }}
        >
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div
                className={cn(
                  'w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-colors',
                  isTailorEnabled
                    ? 'bg-primary text-white shadow-sm group-hover:bg-blue-600'
                    : 'bg-slate-200 text-slate-400'
                )}
              >
                <Plus className="w-5 h-5" />
              </div>
              <CardTitle
                className={cn(
                  'text-base font-semibold',
                  isTailorEnabled
                    ? 'text-slate-900 group-hover:text-primary transition-colors'
                    : 'text-slate-500'
                )}
              >
                {t('dashboard.createResume')}
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-2 leading-relaxed">
                {isTailorEnabled
                  ? '// ' + t('dashboard.initializeSequence')
                  : '// ' + t('dashboard.setupRequiredMessage')}
              </CardDescription>
            </div>
            {isTailorEnabled ? (
              <p className="text-xs font-semibold text-primary pt-4 flex items-center gap-1">
                + {t('dashboard.createResume')} &rarr;
              </p>
            ) : (
              <span className="text-[11px] font-mono text-amber-700/80 pt-4 uppercase">
                {masterResumeId ? '[API Key Required]' : '[Master Resume Required]'}
              </span>
            )}
          </div>
        </Card>

        <MasterResumeChoiceDialog
          open={isMasterChoiceDialogOpen}
          onOpenChange={setIsMasterChoiceDialogOpen}
          onChooseUpload={handleChooseUpload}
          onChooseWizard={handleChooseWizard}
        />
        <ResumeUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={handleUploadDialogOpenChange}
          onUploadComplete={handleUploadComplete}
          becomesDefault={reuploadReplacesDefault}
          trigger={<button type="button" className="hidden" tabIndex={-1} aria-hidden="true" />}
        />

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title={t('confirmations.deleteMasterResumeTitle')}
          description={t('confirmations.deleteMasterResumeDescription')}
          confirmLabel={t('dashboard.deleteAndReupload')}
          cancelLabel={t('confirmations.keepResumeCancelLabel')}
          onConfirm={confirmDeleteAndReupload}
          variant="danger"
        />

        <ConfirmDialog
          open={deleteError}
          onOpenChange={setDeleteError}
          title={t('common.error')}
          description={t('dashboard.errors.deleteFailed')}
          confirmLabel={t('common.retry')}
          cancelLabel={t('common.cancel')}
          onConfirm={confirmDeleteAndReupload}
          onCancel={() => setDeleteError(false)}
          variant="danger"
        />

        <ConfirmDialog
          open={actionError !== null}
          onOpenChange={(open) => !open && setActionError(null)}
          title={t('common.error')}
          description={actionError ?? ''}
          confirmLabel={t('common.ok')}
          onConfirm={() => setActionError(null)}
          variant="danger"
          showCancelButton={false}
        />
      </SwissGrid>
    </div>
  );
}
