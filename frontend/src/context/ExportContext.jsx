import { createContext, useContext, useState, useCallback } from 'react'

/**
 * Export Context
 *
 * Manages queued charts for PPTX and Excel export.
 *
 * Each item:
 * {
 *   id: string,
 *   title: string,
 *   pptx_title: string,    // short title for slide header
 *   subheading: string,    // date range + optional currency, e.g. "01.01.2025 – 09.03.2026, in EUR"
 *   yAxisLabel: string,    // e.g. '%', 'Wert', 'Index' – used for PPTX y-axis title & Excel unit row
 *   source: string,        // data source text
 *   tab: string,
 *   group: number,         // same group = same sheet / slide
 *   chartData: array,
 *   regions: string[],
 *   xKey: string,
 * }
 */
const ExportContext = createContext(null)

export function ExportProvider({ children }) {
  const [pptxItems, setPptxItems] = useState([])
  const [xlsxItems, setXlsxItems] = useState([])
  const [pptxModalOpen, setPptxModalOpen] = useState(false)
  const [xlsxModalOpen, setXlsxModalOpen] = useState(false)

  const _nextGroup = (items) =>
    items.length === 0 ? 1 : Math.max(...items.map((i) => i.group)) + 1

  const addToPptx = useCallback((item) => {
    setPptxItems((prev) => {
      if (prev.find((i) => i.id === item.id)) return prev
      return [...prev, { ...item, group: _nextGroup(prev) }]
    })
  }, [])

  const addToXlsx = useCallback((item) => {
    setXlsxItems((prev) => {
      if (prev.find((i) => i.id === item.id)) return prev
      return [...prev, { ...item, group: _nextGroup(prev) }]
    })
  }, [])

  const removeFromPptx = useCallback((id) => {
    setPptxItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const removeFromXlsx = useCallback((id) => {
    setXlsxItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const updatePptxGroup = useCallback((id, group) => {
    setPptxItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, group } : i))
    )
  }, [])

  const updateXlsxGroup = useCallback((id, group) => {
    setXlsxItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, group } : i))
    )
  }, [])

  const clearPptx = useCallback(() => setPptxItems([]), [])
  const clearXlsx = useCallback(() => setXlsxItems([]), [])

  // Quick-grouping helpers (mirrors original quick-one/two/four)
  const quickGroupPptx = useCallback((perSlide) => {
    setPptxItems((prev) =>
      prev.map((item, i) => ({ ...item, group: Math.floor(i / perSlide) + 1 }))
    )
  }, [])

  const quickGroupXlsx = useCallback((perSheet) => {
    setXlsxItems((prev) =>
      prev.map((item, i) => ({ ...item, group: Math.floor(i / perSheet) + 1 }))
    )
  }, [])

  return (
    <ExportContext.Provider
      value={{
        pptxItems,
        xlsxItems,
        pptxModalOpen,
        xlsxModalOpen,
        setPptxModalOpen,
        setXlsxModalOpen,
        addToPptx,
        addToXlsx,
        removeFromPptx,
        removeFromXlsx,
        updatePptxGroup,
        updateXlsxGroup,
        clearPptx,
        clearXlsx,
        quickGroupPptx,
        quickGroupXlsx,
      }}
    >
      {children}
    </ExportContext.Provider>
  )
}

export function useExport() {
  const ctx = useContext(ExportContext)
  if (!ctx) throw new Error('useExport must be used within an ExportProvider')
  return ctx
}
