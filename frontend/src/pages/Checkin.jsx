import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../api'

const WARM_QUOTES = [
  "你不需要完美，你只需要真实。",
  "每一天都是新的开始，今天也值得期待。",
  "你的存在本身就是这个世界的礼物。",
  "慢慢来，比较快。",
  "你比想象中更勇敢，比看起来更坚强。",
  "被需要是一种幸福，你需要别人也是一种勇气。",
  "即使是最长的夜，也会迎来黎明。",
  "你值得被温柔以待。",
  "生活不会一直难下去，撑住。",
  "你的感受很重要，不需要为它们道歉。",
  "累了就休息一下，这不是放弃。",
  "你已经很努力了，真的。",
  "有些路很远，但走着走着就近了。",
  "允许自己脆弱，这本身就是一种力量。",
  "今天也要好好照顾自己。",
  "世界因为有你在而不同。",
  "你不需要一个人扛，说出来就好。",
  "每一个微小的进步，都值得庆祝。",
  "你配得上这世间所有美好。",
  "深呼吸，一切都会好的。",
  "你不是负担，你是被珍视的人。",
  "此刻的困难，终将成为过去。",
  "给自己一个拥抱吧，你值得。",
  "不完美也没关系，够好就够了。",
  "你的笑容很珍贵，请多笑笑。",
  "有人正在想念你。",
  "再坚持一下，说不定明天就有好事发生。",
  "你的善良，总会被看见。",
  "无论发生什么，你都值得被爱。",
  "太阳每天都会升起，为你。",
]

export default function CheckinPage({ userId }) {
  const [info, setInfo] = useState(null)
  const [intervalDays, setIntervalDays] = useState(3)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState('')
  const [quote, setQuote] = useState('')
  const [clinics, setClinics] = useState([])
  const [loadingClinics, setLoadingClinics] = useState(false)
  const timerRef = useRef(null)
  const quoteTimerRef = useRef(null)

  const fetchInfo = async () => {
    const res = await apiFetch('/api/checkin')
    const data = await res.json()
    setInfo(data)
    setIntervalDays(data.intervalDays)
  }

  const tick = () => {
    setInfo(prev => {
      if (!prev) return prev
      const remaining = Math.max(0, prev.remainingMs - 1000)
      return { ...prev, remainingMs: remaining, overdue: remaining <= 0 }
    })
  }

  const pickQuote = useCallback(() => {
    const idx = Math.floor(Math.random() * WARM_QUOTES.length)
    setQuote(WARM_QUOTES[idx])
  }, [])

  useEffect(() => {
    pickQuote()
    const scheduleNext = () => {
      const delay = 15000 + Math.random() * 15000
      quoteTimerRef.current = setTimeout(() => {
        pickQuote()
        scheduleNext()
      }, delay)
    }
    scheduleNext()
    return () => clearTimeout(quoteTimerRef.current)
  }, [pickQuote])

  useEffect(() => { fetchInfo() }, [])

  useEffect(() => {
    if (info) {
      timerRef.current = setInterval(tick, 1000)
      return () => clearInterval(timerRef.current)
    }
  }, [info?.deadline])

  useEffect(() => {
    fetchNearbyClinics()
  }, [])

  const fetchNearbyClinics = async () => {
    setLoadingClinics(true)
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      })
      const { latitude, longitude } = pos.coords
      const res = await apiFetch(`/api/nearby-clinics?lng=${longitude}&lat=${latitude}`)
      const data = await res.json()
      if (data.pois) {
        setClinics(data.pois.map(poi => ({
          name: poi.name,
          address: poi.address,
          distance: poi.distance || '',
          tel: poi.tel || '',
        })))
      }
    } catch {
      setClinics([
        { name: '北京心理危机研究与干预中心', address: '北京市西城区德外安康胡同5号', distance: '', tel: '010-82951332' },
        { name: '上海市精神卫生中心', address: '上海市徐汇区宛平南路600号', distance: '', tel: '021-64387250' },
        { name: '广州市惠爱医院', address: '广州市荔湾区明心路36号', distance: '', tel: '020-81899120' },
      ])
    }
    setLoadingClinics(false)
  }

  const doCheckin = async () => {
    setChecking(true)
    const res = await apiFetch('/api/checkin', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setMsg('打卡成功！')
      fetchInfo()
    }
    setChecking(false)
    setTimeout(() => setMsg(''), 2000)
  }

  const updateInterval = async () => {
    const res = await apiFetch('/api/checkin/interval', {
      method: 'PUT',
      body: JSON.stringify({ days: intervalDays }),
    })
    const data = await res.json()
    if (data.success) {
      setMsg('间隔已更新')
      fetchInfo()
    }
    setTimeout(() => setMsg(''), 2000)
  }

  const formatRemaining = (ms) => {
    if (ms <= 0) return '已超时'
    const totalSec = Math.floor(ms / 1000)
    const d = Math.floor(totalSec / 86400)
    const h = Math.floor((totalSec % 86400) / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = n => String(n).padStart(2, '0')
    if (d > 0) return `${d}天 ${pad(h)}:${pad(m)}:${pad(s)}`
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }

  if (!info) return <div className="loading">加载中...</div>

  const pct = info.deadline
    ? Math.min(100, (info.remainingMs / (info.intervalDays * 86400000)) * 100)
    : 100

  return (
    <div className="page checkin-page">
      <div className={`countdown-card ${info.overdue ? 'overdue' : ''}`}>
        <div className="countdown-label">{info.overdue ? '已超时！' : '距离下次打卡'}</div>
        <div className="countdown-time">{formatRemaining(info.remainingMs)}</div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {info.overdue && info.unsentLetterCount > 0 && (
          <div className="overdue-warning">
            您有 {info.unsentLetterCount} 封遗书等待发送，请尽快打卡！
          </div>
        )}
      </div>

      <div className="warm-quote-card">
        <div className="quote-mark">"</div>
        <p className="quote-text">{quote}</p>
      </div>

      <button
        className="btn btn-primary btn-lg"
        onClick={doCheckin}
        disabled={checking}
      >
        {checking ? '打卡中...' : '一键打卡'}
      </button>

      {msg && <div className="msg">{msg}</div>}

      <div className="card mental-health-card">
        <h3>心理援助热线</h3>
        <div className="hotline-item">
          <span className="hotline-name">全国24小时心理援助热线</span>
          <a className="hotline-number" href="tel:4001619995">400-161-9995</a>
        </div>
        <div className="hotline-item">
          <span className="hotline-name">北京心理危机研究与干预中心</span>
          <a className="hotline-number" href="tel:01082951332">010-82951332</a>
        </div>
        <div className="hotline-item">
          <span className="hotline-name">希望24热线</span>
          <a className="hotline-number" href="tel:4001619995">400-161-9995</a>
        </div>
      </div>

      <div className="card clinics-card">
        <h3>附近心理咨询机构</h3>
        {loadingClinics ? (
          <div className="loading-sm">正在定位附近机构...</div>
        ) : (
          <div className="clinic-list">
            {clinics.map((c, i) => (
              <div key={i} className="clinic-item">
                <div className="clinic-name">{c.name}</div>
                <div className="clinic-addr">{c.address}</div>
                {c.distance && <div className="clinic-dist">{c.distance}</div>}
                {c.tel && <a className="clinic-tel" href={`tel:${c.tel.replace(/-/g, '')}`}>{c.tel}</a>}
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-sm" onClick={fetchNearbyClinics} style={{ marginTop: 8 }}>
          刷新定位
        </button>
      </div>

      <div className="setting-card">
        <label>打卡间隔（天）</label>
        <div className="interval-row">
          <input
            type="range"
            min={1}
            max={7}
            value={intervalDays}
            onChange={e => setIntervalDays(Number(e.target.value))}
          />
          <span className="interval-val">{intervalDays} 天</span>
        </div>
        <button className="btn btn-sm" onClick={updateInterval}>保存</button>
      </div>
    </div>
  )
}
