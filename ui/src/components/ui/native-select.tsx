import * as React from "react"
import { cn } from "cn"
import { Select, SelectTrigger, SelectContent, SelectItem } from "./select"

// The app's selects keep the <select> API (value, onChange(e) → e.target.value, <NativeSelectOption> children) but
// open the design system's list, never the OS one (TASTE: no OS-native dropdown lists). An empty option that reads
// like a prompt ("Move to…") is the placeholder; any other empty option ("All tools") is a choice like the rest.
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}
type Opt = { value: string; text: string; disabled?: boolean }
const NONE = "\u0000none" // stands in for "" while it's a real choice: the list maps "" to "nothing picked"

const textOf = (n: React.ReactNode): string =>
  typeof n === "string" || typeof n === "number" ? String(n)
    : Array.isArray(n) ? n.map(textOf).join("")
    : React.isValidElement(n) ? textOf((n.props as { children?: React.ReactNode }).children) : ""

function optionsOf(children: React.ReactNode, out: Opt[] = []) {
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return
    const pr = c.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean }
    if (c.type === NativeSelectOption) out.push({ value: String(pr.value ?? textOf(pr.children)), text: textOf(pr.children), disabled: pr.disabled })
    else if (pr.children) optionsOf(pr.children, out) // optgroups, fragments
  })
  return out
}

const NativeSelect = React.forwardRef<HTMLButtonElement, NativeSelectProps>(function NativeSelect(
  { className, size, value, defaultValue, onChange, children, disabled, style, id, onClick, ...rest }, ref) {
  const opts = optionsOf(children)
  const blank = opts.find((o) => o.value === "")
  const prompt = blank && /…$/.test(blank.text.trim()) ? blank.text : null
  const items = opts.filter((o) => o.value !== "" || !prompt).map((o) => (o.value === "" ? { ...o, value: NONE } : o))
  const show = (v: unknown) => (v === undefined ? undefined : String(v) === "" ? (prompt ? "" : NONE) : String(v))
  const pick = (v: string) => {
    const out = v === NONE ? "" : v
    onChange?.({ target: { value: out }, currentTarget: { value: out } } as unknown as React.ChangeEvent<HTMLSelectElement>)
  }
  return (
    <Select value={show(value)} defaultValue={show(defaultValue)} onValueChange={pick} disabled={disabled} size={size === "sm" || /\bsm\b/.test(className ?? "") ? "compact" : undefined}>
      <SelectTrigger ref={ref} id={id} style={style} onClick={onClick as unknown as React.MouseEventHandler<HTMLButtonElement>}
        className={cn("min-w-0", className)} aria-label={rest["aria-label"]} placeholder={prompt ?? "Choose…"} />
      <SelectContent>
        {items.map((o, i) => (<SelectItem key={o.value} index={i} value={o.value} disabled={o.disabled}>{o.text}</SelectItem>))}{/* plain text, so the trigger can name the pick */}
      </SelectContent>
    </Select>
  )
})

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option {...props} /> // read by NativeSelect, never drawn
}

function NativeSelectOptGroup({ children }: React.ComponentProps<"optgroup">) {
  return <>{children}</>
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
