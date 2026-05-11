import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

export default function ProfilePage({ onLogout }) {
  const [user, setUser] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editNickname, setEditNickname] = useState('')
  const [editSignature, setEditSignature] = useState('')
  const [msg, setMsg] = useState('')

  const parseUTC = (dateStr) => {
    const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    return new Date(utcStr)
  }

  const fetchUser = async () => {
    const res = await apiFetch('/api/users/me')
    const data = await res.json()
    setUser(data)
    setEditNickname(data.nickname)
    setEditSignature(data.signature)
  }

  useEffect(() => { fetchUser() }, [])

  const saveProfile = async () => {
    await apiFetch('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify({ nickname: editNickname, signature: editSignature }),
    })
    setEditing(false)
    fetchUser()
    setMsg('保存成功')
    setTimeout(() => setMsg(''), 2000)
  }

  if (!user) return <div className="loading">加载中...</div>

  return (
    <div className="page profile-page">
      <div className="card profile-card">
        <div className="avatar">{user.nickname[0]}</div>
        {editing ? (
          <div className="profile-edit">
            <input
              placeholder="昵称"
              value={editNickname}
              onChange={e => setEditNickname(e.target.value)}
            />
            <input
              placeholder="个性签名"
              value={editSignature}
              onChange={e => setEditSignature(e.target.value)}
            />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={saveProfile}>保存</button>
              <button className="btn" onClick={() => { setEditing(false); setEditNickname(user.nickname); setEditSignature(user.signature) }}>取消</button>
            </div>
          </div>
        ) : (
          <div className="profile-info">
            <h2>{user.nickname}</h2>
            <p className="signature">{user.signature || '暂无签名'}</p>
            <button className="btn" onClick={() => setEditing(true)}>编辑资料</button>
          </div>
        )}
      </div>

      {msg && <div className="msg">{msg}</div>}

      <div className="card stats-card">
        <h3>打卡信息</h3>
        <div className="stat-row">
          <span>打卡间隔</span>
          <span>{user.checkin_interval_days} 天</span>
        </div>
        <div className="stat-row">
          <span>上次打卡</span>
          <span>{user.last_checkin_at ? parseUTC(user.last_checkin_at).toLocaleString() : '从未打卡'}</span>
        </div>
        <div className="stat-row">
          <span>注册时间</span>
          <span>{parseUTC(user.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <button className="btn btn-danger" style={{ width: '100%', marginTop: 16 }} onClick={onLogout}>退出登录</button>
    </div>
  )
}
