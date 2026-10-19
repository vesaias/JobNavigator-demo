// The one demo marker: a quiet rail row ("Sample data · Reset demo") and the not-affiliated line (Settings colophon).
// Loaded only in the demo build (dynamic import behind __DEMO__).
import React, { useState } from 'react'
import { Helper } from '../ui'
import ConfirmDialog from '../ConfirmDialog'
import { resetStore } from './store.js'

export const NOT_AFFILIATED = 'Job postings are snapshots for this demo; not affiliated with the companies.'

export default function DemoMarker({ open }) {
  const [asking, setAsking] = useState(false)
  if (!open) return null
  const reset = () => { setAsking(false); resetStore(); window.location.reload() }
  return (
    <>
      {/* Same shape as the rail's health row: 20px inset, 11.5px dim text, rail tokens only. */}
      <div data-demo-marker="" title={NOT_AFFILIATED}
        style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', height: 30, padding: '0 20px', borderTop: '1px solid var(--rail-line)', whiteSpace: 'nowrap' }}>
        <span style={{ flex: '0 0 24px', display: 'flex' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', border: '1px solid var(--rail-dim)', boxSizing: 'border-box' }} />
        </span>
        <span style={{ flex: 1, fontSize: 11.5, lineHeight: '18px', color: 'var(--rail-dim)' }}>Sample data</span>
        <span role="button" tabIndex={0} className="v2-navdark" onClick={() => setAsking(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAsking(true) } }}
          style={{ fontSize: 11.5, lineHeight: '18px', color: 'var(--rail-text)', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--rail-line)' }}>Reset demo</span>
      </div>
      {/* Outside the nowrap row so the dialog text wraps. */}
      {asking && <ConfirmDialog title="Reset the demo?" body="Your changes in this browser are discarded and the sample data comes back."
        label="Reset" danger onConfirm={reset} onCancel={() => setAsking(false)} />}
    </>
  )
}

export function DemoNote() {
  return <Helper style={{ padding: '2px 0 6px' }}>{NOT_AFFILIATED}</Helper>
}
