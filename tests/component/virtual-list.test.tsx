// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualList, clearScrollMemory } from '~/components/virtual-list'
import { ScrollHarness } from './virtual-layout'

/**
 * Apa yang dijaga berkas ini:
 *
 * 1. Di bawah ambang, SEMUA baris ada di DOM. Ini yang membuat ±45 test komponen lain tetap sah:
 *    fixture mereka 2–5 baris, jadi mereka memakai jalur biasa.
 * 2. Tanpa scroller sama sekali, SEMUA baris ada di DOM. Test komponen merender route tanpa
 *    AppShell, jadi jalur ini bukan teori.
 * 3. Di atas ambang DENGAN scroller, hanya jendela yang ada di DOM — tapi aria-setsize tetap
 *    menyebut jumlah penuh, karena pembaca layar tidak bisa menghitung sendiri lagi.
 * 4. Posisi scroll diingat per restoreKey, dan kunci yang berbeda mulai dari atas. Yang terakhir
 *    adalah bug virtualisasi nomor satu: menyaring daftar sambil scroller tetap di 40.000px
 *    membuat daftar tampak kosong.
 */

type Row = { id: string; label: string }

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `R${index}`,
    label: `Baris ${index}`,
  }))
}

const ROW_HEIGHT = 100

function List({ data, restoreKey }: { data: Row[]; restoreKey?: string }) {
  return (
    <VirtualList
      as="ul"
      rows={data}
      getKey={(row) => row.id}
      rowHeight={() => ROW_HEIGHT}
      restoreKey={restoreKey}
      label="Daftar uji"
      renderRow={(row) => <span>{row.label}</span>}
    />
  )
}

beforeEach(() => {
  clearScrollMemory()
})

describe('VirtualList', () => {
  it('di bawah ambang merender semua baris', () => {
    render(
      <ScrollHarness contentHeight={10 * ROW_HEIGHT}>
        <List data={rows(10)} />
      </ScrollHarness>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('Baris 9')).toBeInTheDocument()
  })

  it('tanpa scroller merender semua baris walau jauh di atas ambang', () => {
    render(<List data={rows(300)} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(300)
  })

  it('di atas ambang dengan scroller hanya merender jendela, tapi menyebut jumlah penuh', () => {
    render(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <List data={rows(300)} />
      </ScrollHarness>,
    )

    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThan(40)
    // Jumlah penuh, bukan jumlah yang ter-render.
    expect(items[0]).toHaveAttribute('aria-setsize', '300')
    expect(items[0]).toHaveAttribute('aria-posinset', '1')
    // Baris terakhir tidak ada di DOM — itu seluruh gunanya.
    expect(screen.queryByText('Baris 299')).not.toBeInTheDocument()
  })

  it('memaksa tinggi baris lewat inline style di jalur biasa', () => {
    render(
      <ScrollHarness contentHeight={3 * ROW_HEIGHT}>
        <List data={rows(3)} />
      </ScrollHarness>,
    )

    const [first] = screen.getAllByRole('listitem')
    expect(first).toHaveStyle({ height: `${ROW_HEIGHT}px`, overflow: 'hidden' })
  })

  it('mengingat posisi scroll per kunci, dan kunci baru mulai dari atas', () => {
    const view = render(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <List data={rows(300)} restoreKey="uji:a" />
      </ScrollHarness>,
    )
    const scroller = screen.getByTestId('scroller')

    scroller.scrollTop = 1500
    // Melepas daftar sementara scroller-nya tetap terpasang: itu persis yang terjadi saat operator
    // membuka detail PO.
    view.rerender(<ScrollHarness contentHeight={300 * ROW_HEIGHT}>{null}</ScrollHarness>)
    scroller.scrollTop = 0

    view.rerender(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <List data={rows(300)} restoreKey="uji:a" />
      </ScrollHarness>,
    )
    expect(scroller.scrollTop).toBe(1500)

    // Kunci lain — mis. filter berubah — tidak boleh memulihkan offset milik kunci sebelumnya.
    view.rerender(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <List data={rows(300)} restoreKey="uji:b" />
      </ScrollHarness>,
    )
    expect(scroller.scrollTop).toBe(0)

    // Dan kembali ke kunci pertama memulihkan offsetnya. Ini yang mengunci bahwa penyimpanan
    // offset adalah LAYOUT effect: sebagai passive effect ia akan menyimpan 0 (posisi SETELAH
    // pindah kunci) dan posisi filter sebelumnya hilang.
    view.rerender(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <List data={rows(300)} restoreKey="uji:a" />
      </ScrollHarness>,
    )
    expect(scroller.scrollTop).toBe(1500)
  })

  /**
   * Scroller yang sudah ter-commit lebih dulu harus membuat render PERTAMA sudah berjendela.
   *
   * Ini bentuk yang dipakai kokpit: panel scroll-nya tetap ter-mount saat operator pindah ke tab
   * "Item", jadi hanya daftarnya yang baru. Tanpa membaca `scrollRef.current` saat render,
   * `VirtualList` harus menunggu effect-nya dan karena itu merender SELURUH baris satu kali dulu —
   * persis hang yang virtualisasi ada untuk mencegahnya, pada perangkat yang paling tidak bisa
   * membayarnya.
   *
   * Yang dihitung adalah pemanggilan `renderRow`, bukan isi DOM: perbedaannya bersifat sementara
   * dan sudah hilang begitu commit selesai, jadi DOM akhir terlihat sama di kedua keadaan.
   */
  it('scroller yang sudah ada membuat render pertama langsung berjendela', () => {
    const renderRow = vi.fn((row: Row) => <span>{row.label}</span>)
    const data = rows(300)

    // Satu commit untuk scroller-nya saja, persis seperti panel tab kokpit yang sudah terbuka.
    const view = render(<ScrollHarness contentHeight={300 * ROW_HEIGHT}>{null}</ScrollHarness>)

    view.rerender(
      <ScrollHarness contentHeight={300 * ROW_HEIGHT}>
        <VirtualList
          as="ul"
          rows={data}
          getKey={(row) => row.id}
          rowHeight={() => ROW_HEIGHT}
          label="Daftar uji"
          renderRow={renderRow}
        />
      </ScrollHarness>,
    )

    expect(screen.getAllByRole('listitem').length).toBeLessThan(40)
    // Jauh di bawah 300: tidak pernah ada satu pass pun yang merender seluruh daftar.
    expect(renderRow.mock.calls.length).toBeLessThan(40)
  })

  /**
   * Array `rows` yang baru HARUS membangun ulang pengukuran.
   *
   * Ini mekanisme yang diandalkan setiap pemanggil: `virtual-core` membangun ulang pengukurannya
   * ketika `getItemKey` berganti identitas, dan TIDAK PERNAH karena `estimateSize` kini menjawab
   * berbeda — jadi identitas `rows` adalah satu-satunya sinyal yang tersisa. Kokpit pernah
   * melanggarnya: tingginya membaca peta PO dari closure, peta itu datang satu putaran Dexie
   * setelah barisnya, dan baris "Dipesan N" terpotong habis oleh tinggi yang sudah terlanjur
   * dipaku. Kalau test ini pecah, aturan "setiap input tinggi harus ada di dalam `rows`" kehilangan
   * dasarnya dan enam pemanggil ikut terdampak.
   */
  it('array rows yang baru membangun ulang tinggi, meski panjang dan kuncinya sama', () => {
    const view = render(
      <ScrollHarness contentHeight={80 * ROW_HEIGHT}>
        <VirtualList
          as="ul"
          rows={rows(80)}
          getKey={(row) => row.id}
          rowHeight={() => ROW_HEIGHT}
          label="Daftar uji"
          renderRow={(row) => <span>{row.label}</span>}
        />
      </ScrollHarness>,
    )
    expect(screen.getAllByRole('listitem')[0]).toHaveStyle({ height: `${ROW_HEIGHT}px` })

    // Panjang sama, kunci sama, hanya tingginya yang kini dijawab berbeda — dan array-nya baru.
    view.rerender(
      <ScrollHarness contentHeight={80 * ROW_HEIGHT}>
        <VirtualList
          as="ul"
          rows={rows(80)}
          getKey={(row) => row.id}
          rowHeight={() => ROW_HEIGHT * 2}
          label="Daftar uji"
          renderRow={(row) => <span>{row.label}</span>}
        />
      </ScrollHarness>,
    )
    expect(screen.getAllByRole('listitem')[0]).toHaveStyle({ height: `${ROW_HEIGHT * 2}px` })
  })
})
