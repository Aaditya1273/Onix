'use client'

import React, { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'

interface CostChartProps {
  data: number[]
  labels: string[]
  /** Accessible summary of what the chart shows; pair it with a table alternative. */
  ariaLabel: string
  yTitle?: string
  xTitle?: string
  color?: string
  height?: number
}

const AXIS = '#6b6158', GRID = '#e6ded2', FONT = { size: 12, family: 'Inter, system-ui, sans-serif' }

export function CostChart({ data, labels, ariaLabel, yTitle = 'USD', xTitle, color = '#ff6b00', height = 240 }: CostChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const money = (v: number) => `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`

    chartRef.current?.destroy()
    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: yTitle,
          data: [],
          borderColor: color,
          backgroundColor: `${color}1f`,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0, // straight segments: smoothing would draw values that were never sampled
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: still ? false : { duration: 300 },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#14100d', titleColor: '#e6ded2', bodyColor: '#ffffff',
            padding: 10, displayColors: false,
            callbacks: { label: c => money(Number(c.raw)) },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { color: AXIS, font: FONT, maxTicksLimit: 7, maxRotation: 0 },
            title: xTitle ? { display: true, text: xTitle, color: AXIS, font: FONT } : undefined,
          },
          y: {
            beginAtZero: true,
            grid: { color: GRID, drawBorder: false },
            // One precision for every tick on the axis, chosen from its largest value.
            ticks: { color: AXIS, font: FONT, maxTicksLimit: 5, callback: (v, _i, ticks) => `$${Number(v).toFixed(Math.max(...ticks.map(t => t.value)) >= 1 ? 2 : 4)}` },
            title: { display: true, text: yTitle, color: AXIS, font: FONT },
          },
        },
      },
    })
    return () => { chartRef.current?.destroy(); chartRef.current = null }
  }, [color, yTitle, xTitle])

  // New samples update the existing chart in place, so a poll does not redraw from scratch.
  useEffect(() => {
    const c = chartRef.current
    if (!c) return
    c.data.labels = labels
    c.data.datasets[0].data = data
    c.update()
  }, [data, labels, color, yTitle, xTitle])

  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  )
}
