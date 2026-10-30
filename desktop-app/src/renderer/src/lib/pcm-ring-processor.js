class ConcordPcmRing extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = 48000 * 2
    this.left = new Float32Array(this.capacity)
    this.right = new Float32Array(this.capacity)
    this.read = 0
    this.write = 0
    this.size = 0
    this.primed = false
    this.port.onmessage = (event) => {
      const pcm = event.data
      if (!pcm || pcm.length < 2) return
      const frames = Math.floor(pcm.length / 2)
      for (let index = 0; index < frames; index += 1) {
        if (this.size >= this.capacity) {
          this.read = (this.read + 1) % this.capacity
          this.size -= 1
        }
        this.left[this.write] = pcm[index * 2] / 32768
        this.right[this.write] = pcm[index * 2 + 1] / 32768
        this.write = (this.write + 1) % this.capacity
        this.size += 1
      }
      if (this.size >= 4800) this.primed = true
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0]
    const left = channels?.[0]
    const right = channels?.[1]
    if (!left) return true
    const frames = left.length
    if (!this.primed || this.size < frames) {
      left.fill(0)
      right?.fill(0)
      if (this.size < 960) this.primed = false
      return true
    }
    for (let index = 0; index < frames; index += 1) {
      left[index] = this.left[this.read]
      if (right) right[index] = this.right[this.read]
      this.read = (this.read + 1) % this.capacity
      this.size -= 1
    }
    return true
  }
}

registerProcessor('concord-pcm-ring', ConcordPcmRing)
