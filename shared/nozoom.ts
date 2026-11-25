/**
 * Two-finger (pinch) zoom off, on both pages. The viewport meta (`maximum-scale=1, user-scalable=no`) is
 * enough for Android Chrome; iOS Safari ignores it, so the gesture is also cancelled here:
 *   - `gesturestart` / `gesturechange` / `gestureend` (WebKit-only pinch events),
 *   - `touchmove` with two or more fingers (non-passive so preventDefault takes effect).
 * One-finger scrolling and taps are untouched. Returns a function that removes the listeners.
 */
export function blockPinchZoom(doc: Document = document): () => void {
  const stop = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  const onTouch = (e: TouchEvent): void => { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); };
  const opts: AddEventListenerOptions = { passive: false };
  const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const g of gestures) doc.addEventListener(g, stop, opts);
  doc.addEventListener('touchmove', onTouch, opts);
  return () => {
    for (const g of gestures) doc.removeEventListener(g, stop, opts);
    doc.removeEventListener('touchmove', onTouch, opts);
  };
}
