import { useState, useEffect, useCallback, Component } from 'react'
import CheckinPage from './pages/Checkin'
import LettersPage from './pages/Letters'
import CommunityPage from './pages/Community'
import ProfilePage from './pages/Profile'
import { logout, apiFetch, apiFetchJson, setOnUnauthorized } from './api'
import './App.css'

const tabs = [
  { key: 'checkin', label: '打卡', icon: '⏰' },
  { key: 'letters', label: '写信', icon: '✉️' },
  { key: 'community', label: '社区', icon: '💬' },
  { key: 'profile', label: '个人', icon: '👤' },
]

function ForceResetPage({ user, onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 4) { setError('密码至少4位'); return }
    if (password !== confirmPwd) { setError('两次密码不一致'); return }
    try {
      const data = await apiFetchJson('/api/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      if (data.success) {
        onDone()
      } else {
        setError(data.error || '设置失败')
      }
    } catch (e) {
      setError(e.message || '设置失败')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>设置密码</h1>
        <p className="login-subtitle">为了您的账号安全，请先设置一个密码</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="设置密码（至少4位）"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
            autoFocus
          />
          <input
            type="password"
            placeholder="确认密码"
            value={confirmPwd}
            onChange={e => { setConfirmPwd(e.target.value); setError('') }}
          />
          {error && <div className="modal-error">{error}</div>}
          <button className="btn btn-primary" type="submit">确认</button>
        </form>
      </div>
    </div>
  )
}

function BindEmailPage({ onDone }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async (e) => {
    e?.preventDefault()
    if (!email.trim() || sending) return
    setError('')
    setSending(true)
    try {
      const res = await apiFetch('/api/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), type: 'bind' }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '发送失败'); return }
      if (data.success) {
        setCodeSent(true)
        setCountdown(60)
      } else {
        setError(data.error || '发送失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('请输入邮箱'); return }
    if (!code) { setError('请输入验证码'); return }
    setError('')
    try {
      const res = await apiFetch('/api/auth/bind-email', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '绑定失败'); return }
      if (data.success) {
        onDone()
      } else {
        setError(data.error || '绑定失败')
      }
    } catch {
      setError('网络错误，请重试')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>绑定邮箱</h1>
        <p className="login-subtitle">为了账号安全，请绑定一个邮箱</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="邮箱地址"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            autoFocus
          />
          <input
            placeholder="验证码（6位数字）"
            value={code}
            onChange={e => { setCode(e.target.value); setError('') }}
            maxLength={6}
            disabled={!codeSent}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            onClick={handleSendCode}
            disabled={sending || countdown > 0 || !email.trim()}
          >
            {sending ? '发送中...' : countdown > 0 ? `${countdown}s后重新发送` : '发送验证码'}
          </button>
          {error && <div className="modal-error">{error}</div>}
          <button className="btn btn-primary" type="submit">确认绑定</button>
        </form>
      </div>
    </div>
  )
}

function ResetPasswordPage({ onBack }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async (e) => {
    e?.preventDefault()
    if (!email.trim() || sending) return
    setError('')
    setSending(true)
    try {
      const res = await apiFetch('/api/auth/reset-password-request', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '发送失败'); return }
      if (data.success) {
        setCodeSent(true)
        setCountdown(60)
      } else {
        setError(data.error || '发送失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('请输入邮箱'); return }
    if (!code) { setError('请输入验证码'); return }
    if (!newPassword) { setError('请输入新密码'); return }
    if (newPassword.length < 4) { setError('密码至少4位'); return }
    if (newPassword !== confirmPwd) { setError('两次密码不一致'); return }
    setError('')
    try {
      const res = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '重置失败'); return }
      if (data.success) {
        setSuccess(true)
      } else {
        setError(data.error || '重置失败')
      }
    } catch {
      setError('网络错误，请重试')
    }
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>密码已重置</h1>
          <p className="login-subtitle">请使用新密码登录</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onBack}>返回登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>找回密码</h1>
        <p className="login-subtitle">通过绑定的邮箱重置密码</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="绑定的邮箱地址"
            value={email}
            onChange={e => { setEmail(e.target.value); setError('') }}
            autoFocus
          />
          <input
            placeholder="验证码（6位数字）"
            value={code}
            onChange={e => { setCode(e.target.value); setError('') }}
            maxLength={6}
            disabled={!codeSent}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            onClick={handleSendCode}
            disabled={sending || countdown > 0 || !email.trim()}
          >
            {sending ? '发送中...' : countdown > 0 ? `${countdown}s后重新发送` : '发送验证码'}
          </button>
          {codeSent && (
            <>
              <input
                type="password"
                placeholder="新密码（至少4位）"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setError('') }}
              />
              <input
                type="password"
                placeholder="确认新密码"
                value={confirmPwd}
                onChange={e => { setConfirmPwd(e.target.value); setError('') }}
              />
            </>
          )}
          {error && <div className="modal-error">{error}</div>}
          {codeSent && (
            <button className="btn btn-primary" type="submit">重置密码</button>
          )}
        </form>
        <button className="btn btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={onBack}>
          返回登录
        </button>
      </div>
    </div>
  )
}

function LoginPage({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  // Register state
  const [registerStep, setRegisterStep] = useState(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  // Login state
  const [account, setAccount] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendCode = async () => {
    if (!email.trim() || sending) return
    setError('')
    setSending(true)
    try {
      const res = await apiFetch('/api/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), type: 'register' }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '发送失败'); return }
      if (data.success) {
        setRegisterStep(2)
        setCountdown(60)
      } else {
        setError(data.error || '发送失败')
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('请输入邮箱'); return }
    if (!code) { setError('请输入验证码'); return }
    if (!nickname.trim()) { setError('请输入昵称'); return }
    if (!password) { setError('请输入密码'); return }
    if (password.length < 4) { setError('密码至少4位'); return }
    if (password !== confirmPwd) { setError('两次密码不一致'); return }
    setError('')
    const res = await apiFetch('/api/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), code, nickname: nickname.trim(), password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || '注册失败'); return }
    if (data.token) {
      onLogin({ id: data.user.id, nickname: data.user.nickname, forceReset: data.user.forceReset, needBindEmail: false })
    } else {
      setError(data.error || '注册失败')
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!account.trim()) { setError('请输入账号'); return }
    if (!loginPassword) { setError('请输入密码'); return }
    setError('')
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: account.trim(), password: loginPassword }),
    })
    const data = await res.json()
    if (!res.ok && !data.needSetPassword) { setError(data.error || '登录失败'); return }
    if (data.token) {
      onLogin({ id: data.user.id, nickname: data.user.nickname, forceReset: data.user.forceReset, needBindEmail: data.user.needBindEmail })
    } else if (data.needSetPassword) {
      setError('该账号需要设置密码后才能登录，请联系管理员')
    } else {
      setError(data.error || '登录失败')
    }
  }

  const switchMode = () => {
    setIsRegister(!isRegister)
    setError('')
    setPassword('')
    setConfirmPwd('')
    setRegisterStep(1)
    setEmail('')
    setCode('')
    setNickname('')
    setShowResetPassword(false)
  }

  if (showResetPassword) {
    return <ResetPasswordPage onBack={() => { setShowResetPassword(false); setError('') }} />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>绝笔信</h1>
        <p className="login-subtitle">定期打卡，确认安好</p>
        {isRegister ? (
          <form onSubmit={handleRegister}>
            {registerStep === 1 ? (
              <>
                <input
                  type="email"
                  placeholder="邮箱地址"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%' }}
                  onClick={handleSendCode}
                  disabled={sending || countdown > 0 || !email.trim()}
                >
                  {sending ? '发送中...' : countdown > 0 ? `${countdown}s后重新发送` : '发送验证码'}
                </button>
              </>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="邮箱"
                  value={email}
                  readOnly
                  style={{ background: '#f0f0f0', color: '#999' }}
                />
                <input
                  placeholder="验证码（6位数字）"
                  value={code}
                  onChange={e => { setCode(e.target.value); setError('') }}
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ width: '100%' }}
                  onClick={handleSendCode}
                  disabled={sending || countdown > 0}
                >
                  {sending ? '发送中...' : countdown > 0 ? `${countdown}s后重新发送` : '重新发送'}
                </button>
                <input
                  placeholder="昵称"
                  value={nickname}
                  onChange={e => { setNickname(e.target.value); setError('') }}
                />
                <input
                  type="password"
                  placeholder="密码（至少4位）"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                />
                <input
                  type="password"
                  placeholder="确认密码"
                  value={confirmPwd}
                  onChange={e => { setConfirmPwd(e.target.value); setError('') }}
                />
              </>
            )}
            {error && <div className="modal-error">{error}</div>}
            {registerStep === 2 && (
              <button className="btn btn-primary" type="submit">注册</button>
            )}
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <input
              placeholder="昵称或邮箱"
              value={account}
              onChange={e => { setAccount(e.target.value); setError('') }}
              autoFocus
            />
            <input
              type="password"
              placeholder="密码"
              value={loginPassword}
              onChange={e => { setLoginPassword(e.target.value); setError('') }}
            />
            {error && <div className="modal-error">{error}</div>}
            <button className="btn btn-primary" type="submit">登录</button>
            <div style={{ textAlign: 'right', marginTop: 4 }}>
              <button type="button" className="btn btn-ghost" style={{ padding: '4px 0', fontSize: 13, color: 'var(--primary)' }} onClick={() => { setShowResetPassword(true); setError('') }}>
                忘记密码？
              </button>
            </div>
          </form>
        )}
        <button className="btn btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={switchMode}>
          {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
        </button>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('checkin')

  const handleUnauthorized = useCallback(() => {
    setUser(null)
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
  }, [])

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized)
  }, [handleUnauthorized])

  useEffect(() => {
    apiFetch('/api/auth/me').then(res => {
      if (res.ok) return res.json()
      return null
    }).then(data => {
      if (data) setUser({ id: data.id, nickname: data.nickname, forceReset: data.forceReset, needBindEmail: data.needBindEmail })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleLogin = (u) => {
    setUser(u)
  }

  const handleLogout = async () => {
    setUser(null)
    await logout()
  }

  if (loading) return <div className="loading">加载中...</div>
  if (!user) return <LoginPage onLogin={handleLogin} />

  if (user.forceReset) {
    return <ForceResetPage user={user} onDone={() => setUser({ ...user, forceReset: false })} />
  }

  if (user.needBindEmail) {
    return <BindEmailPage onDone={() => setUser({ ...user, needBindEmail: false })} />
  }

  const renderPage = () => {
    switch (activeTab) {
      case 'checkin':
        return <CheckinPage userId={user.id} />
      case 'letters':
        return <LettersPage userId={user.id} />
      case 'community':
        return <CommunityPage userId={user.id} />
      case 'profile':
        return <ProfilePage onLogout={handleLogout} />
      default:
        return null
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>绝笔信</h1>
        <span className="header-user">{user.nickname}</span>
      </header>
      <main className="app-content">
        {renderPage()}
      </main>
      <nav className="app-nav">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`nav-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#c00' }}>
          <h2>页面出错了</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error?.message || String(this.state.error)}</pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload() }} style={{ marginTop: 12, padding: '8px 16px' }}>刷新重试</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>
}
