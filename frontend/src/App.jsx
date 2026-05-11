import { useState, useEffect } from 'react'
import CheckinPage from './pages/Checkin'
import LettersPage from './pages/Letters'
import CommunityPage from './pages/Community'
import ProfilePage from './pages/Profile'
import { getToken, setToken, removeToken, isLoggedIn, apiFetch } from './api'
import './App.css'

const tabs = [
  { key: 'checkin', label: '打卡', icon: '⏰' },
  { key: 'letters', label: '写信', icon: '✉️' },
  { key: 'community', label: '社区', icon: '💬' },
  { key: 'profile', label: '个人', icon: '👤' },
]

function LoginPage({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false)
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!nickname.trim()) { setError('请输入昵称'); return }
    if (!password) { setError('请输入密码'); return }
    if (isRegister && password.length < 4) { setError('密码至少4位'); return }
    if (isRegister && password !== confirmPwd) { setError('两次密码不一致'); return }
    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
    const res = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ nickname: nickname.trim(), password }),
    })
    const data = await res.json()
    if (data.token) {
      setToken(data.token)
      onLogin({ id: data.user.id, nickname: data.user.nickname })
    } else {
      setError(data.error || (isRegister ? '注册失败' : '登录失败'))
    }
  }

  const switchMode = () => {
    setIsRegister(!isRegister)
    setError('')
    setPassword('')
    setConfirmPwd('')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>绝笔信</h1>
        <p className="login-subtitle">定期打卡，确认安好</p>
        <form onSubmit={handleSubmit}>
          <input
            placeholder="昵称"
            value={nickname}
            onChange={e => { setNickname(e.target.value); setError('') }}
            autoFocus
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={e => { setPassword(e.target.value); setError('') }}
          />
          {isRegister && (
            <input
              type="password"
              placeholder="确认密码"
              value={confirmPwd}
              onChange={e => { setConfirmPwd(e.target.value); setError('') }}
            />
          )}
          {error && <div className="modal-error">{error}</div>}
          <button className="btn btn-primary" type="submit">
            {isRegister ? '注册' : '登录'}
          </button>
        </form>
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

  useEffect(() => {
    if (!isLoggedIn()) { setLoading(false); return }
    apiFetch('/api/auth/me').then(res => {
      if (res.ok) return res.json()
      return null
    }).then(data => {
      if (data) setUser({ id: data.id, nickname: data.nickname })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleLogin = (u) => {
    setUser(u)
  }

  const handleLogout = () => {
    setUser(null)
    removeToken()
  }

  if (loading) return <div className="loading">加载中...</div>
  if (!user) return <LoginPage onLogin={handleLogin} />

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

export default App
