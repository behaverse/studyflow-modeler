import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {createPortal} from 'react-dom';
import {useHistory} from '@docusaurus/router';
import {usePluginData} from '@docusaurus/useGlobalData';
import Fuse from 'fuse.js';
import './styles.css';

interface SearchDoc {
  title: string;
  url: string;
  description: string;
  content: string;
  headings: string[];
}

interface SearchResult {
  item: SearchDoc;
  matches?: readonly Fuse.FuseResultMatch[];
}

function highlightMatch(
  text: string,
  indices: readonly Fuse.RangeTuple[],
): ReactNode {
  if (!indices || indices.length === 0) return text;

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const [start, end] of indices) {
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(<mark key={start}>{text.slice(start, end + 1)}</mark>);
    lastIndex = end + 1;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

function getSnippet(
  content: string,
  matchIndices?: readonly Fuse.RangeTuple[],
): string {
  if (!matchIndices || matchIndices.length === 0) {
    return content.slice(0, 150) + (content.length > 150 ? '…' : '');
  }

  const firstMatch = matchIndices[0][0];
  const start = Math.max(0, firstMatch - 60);
  const end = Math.min(content.length, firstMatch + 120);
  let snippet = content.slice(start, end);

  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet += '…';

  return snippet;
}

function SearchModal({
  onClose,
  searchDocs,
}: {
  onClose: () => void;
  searchDocs: SearchDoc[];
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const history = useHistory();

  const fuse = useMemo(
    () =>
      new Fuse(searchDocs, {
        keys: [
          {name: 'title', weight: 3},
          {name: 'headings', weight: 2},
          {name: 'description', weight: 1.5},
          {name: 'content', weight: 1},
        ],
        threshold: 0.4,
        includeMatches: true,
        minMatchCharLength: 2,
        ignoreLocation: true,
      }),
    [searchDocs],
  );

  const results: SearchResult[] = useMemo(() => {
    if (query.length < 2) return [];
    return fuse.search(query, {limit: 15});
  }, [query, fuse]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      history.push(result.item.url);
      onClose();
    },
    [history, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            navigateToResult(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, navigateToResult, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.querySelector('.search-result-item--selected');
    if (selected) {
      selected.scrollIntoView({block: 'nearest'});
    }
  }, [selectedIndex]);

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div
        className="search-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-modal-header">
          <svg
            className="search-icon"
            width="20"
            height="20"
            viewBox="0 0 20 20"
          >
            <path
              d="M14.386 14.386l4.0877 4.0877-4.0877-4.0877c-2.9418 2.9419-7.7115 2.9419-10.6533 0-2.9419-2.9418-2.9419-7.7115 0-10.6533 2.9418-2.9419 7.7115-2.9419 10.6533 0 2.9419 2.9418 2.9419 7.7115 0 10.6533z"
              stroke="currentColor"
              fill="none"
              fillRule="evenodd"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search documentation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button className="search-modal-close" onClick={onClose}>
            <kbd>Esc</kbd>
          </button>
        </div>

        <div className="search-modal-body" ref={resultsRef}>
          {query.length < 2 && (
            <div className="search-empty">
              Type at least 2 characters to search
            </div>
          )}
          {query.length >= 2 && results.length === 0 && (
            <div className="search-empty">
              No results found for &ldquo;<strong>{query}</strong>&rdquo;
            </div>
          )}

          {results.map((result, index) => {
            const titleMatch = result.matches?.find((m) => m.key === 'title');
            const contentMatch = result.matches?.find(
              (m) => m.key === 'content',
            );
            const headingsMatch = result.matches?.find(
              (m) => m.key === 'headings',
            );

            return (
              <button
                key={result.item.url}
                className={`search-result-item ${index === selectedIndex ? 'search-result-item--selected' : ''}`}
                onClick={() => navigateToResult(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="search-result-title">
                  {titleMatch
                    ? highlightMatch(result.item.title, titleMatch.indices)
                    : result.item.title}
                </div>
                {headingsMatch && (
                  <div className="search-result-heading">
                    &sect;{' '}
                    {highlightMatch(
                      headingsMatch.value || '',
                      headingsMatch.indices,
                    )}
                  </div>
                )}
                <div className="search-result-snippet">
                  {contentMatch
                    ? getSnippet(result.item.content, contentMatch.indices)
                    : result.item.description ||
                      result.item.content.slice(0, 120) + '…'}
                </div>
              </button>
            );
          })}
        </div>

        {results.length > 0 && (
          <div className="search-modal-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Open
            </span>
            <span>
              <kbd>Esc</kbd> Close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchBar(): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const {searchDocs = []} = (usePluginData(
    'docusaurus-plugin-search-local',
  ) || {}) as {
    searchDocs?: SearchDoc[];
  };

  const openModal = useCallback(() => setIsOpen(true), []);
  const closeModal = useCallback(() => {
    setIsOpen(false);
    searchButtonRef.current?.focus();
  }, []);

  // Global keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || '');

  return (
    <>
      <button
        ref={searchButtonRef}
        className="search-bar-button"
        onClick={openModal}
        aria-label="Search"
      >
        <svg width="16" height="16" viewBox="0 0 20 20">
          <path
            d="M14.386 14.386l4.0877 4.0877-4.0877-4.0877c-2.9418 2.9419-7.7115 2.9419-10.6533 0-2.9419-2.9418-2.9419-7.7115 0-10.6533 2.9418-2.9419 7.7115-2.9419 10.6533 0 2.9419 2.9418 2.9419 7.7115 0 10.6533z"
            stroke="currentColor"
            fill="none"
            fillRule="evenodd"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="search-bar-placeholder">Search</span>
        <kbd className="search-bar-shortcut">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      {isOpen &&
        createPortal(
          <SearchModal onClose={closeModal} searchDocs={searchDocs} />,
          document.body,
        )}
    </>
  );
}
