import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearSessionState, useSessionState } from '@/lib/useSessionState';

describe('useSessionState', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('starts from the initial value when nothing was stored yet', () => {
    const { result } = renderHook(() => useSessionState('list.search', ''));

    expect(result.current[0]).toBe('');
  });

  // The whole point: a list page unmounting (opening a detail page) and
  // mounting again (coming back) keeps what was typed.
  it('restores the last value after the component unmounts and remounts', () => {
    const first = renderHook(() => useSessionState('list.search', ''));
    act(() => first.result.current[1]('Juana'));
    first.unmount();

    const second = renderHook(() => useSessionState('list.search', ''));

    expect(second.result.current[0]).toBe('Juana');
  });

  it('round-trips non-string values', () => {
    const first = renderHook(() => useSessionState('list.page', 1));
    act(() => first.result.current[1](4));
    first.unmount();

    const second = renderHook(() => useSessionState('list.page', 1));

    expect(second.result.current[0]).toBe(4);
  });

  it('never persists anything with a null key', () => {
    const first = renderHook(() => useSessionState<string>(null, ''));
    act(() => first.result.current[1]('Juana'));
    first.unmount();

    const second = renderHook(() => useSessionState<string>(null, ''));

    expect(second.result.current[0]).toBe('');
    expect(sessionStorage.length).toBe(0);
  });

  it('falls back to the initial value when the stored value is corrupt', () => {
    sessionStorage.setItem('collectify.sessionState.list.search', '{not json');

    const { result } = renderHook(() => useSessionState('list.search', ''));

    expect(result.current[0]).toBe('');
  });
});

describe('clearSessionState', () => {
  it("removes only this hook's own keys", () => {
    sessionStorage.setItem('collectify.sessionState.list.search', '"Juana"');
    sessionStorage.setItem('unrelated', 'keep');

    clearSessionState();

    expect(
      sessionStorage.getItem('collectify.sessionState.list.search'),
    ).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });
});
