import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

const NOTIFY_METHODS = [
  { value: 1, label: '邮件' },
  { value: 2, label: '短信' },
]

function ContactForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name, setName] = useState(initial?.name || '')
  const [notifyMethod, setNotifyMethod] = useState(initial?.notify_method || 1)
  const [notifyTarget, setNotifyTarget] = useState(initial?.notify_target || '')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim() || !notifyTarget.trim()) return
    onSubmit({ name: name.trim(), notifyMethod, notifyTarget: notifyTarget.trim() })
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <input
        placeholder="联系人称呼"
        value={name}
        onChange={e => setName(e.target.value)}
        required
      />
      <div className="form-row">
        <label>通知方式</label>
        <select value={notifyMethod} onChange={e => setNotifyMethod(Number(e.target.value))}>
          {NOTIFY_METHODS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <input
        placeholder={notifyMethod === 1 ? '邮箱地址' : '手机号码'}
        value={notifyTarget}
        onChange={e => setNotifyTarget(e.target.value)}
        required
      />
      <div className="btn-row">
        <button className="btn btn-primary" type="submit">{submitLabel}</button>
        <button className="btn" type="button" onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}

export default function ProfilePage({ onLogout }) {
  const [user, setUser] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editNickname, setEditNickname] = useState('')
  const [editSignature, setEditSignature] = useState('')
  const [msg, setMsg] = useState('')
  const [contacts, setContacts] = useState([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [editingContact, setEditingContact] = useState(null)

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

  const fetchContacts = async () => {
    const res = await apiFetch('/api/contacts')
    setContacts(await res.json())
  }

  useEffect(() => { fetchUser(); fetchContacts() }, [])

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

  const addContact = async ({ name, notifyMethod, notifyTarget }) => {
    const res = await apiFetch('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ name, notifyMethod, notifyTarget }),
    })
    const data = await res.json()
    if (data.success) {
      setShowAddContact(false)
      fetchContacts()
      setMsg('联系人已添加')
      setTimeout(() => setMsg(''), 2000)
    }
  }

  const updateContact = async ({ name, notifyMethod, notifyTarget }) => {
    const res = await apiFetch(`/api/contacts/${editingContact.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, notifyMethod, notifyTarget }),
    })
    const data = await res.json()
    if (data.success) {
      setEditingContact(null)
      fetchContacts()
      setMsg('联系人已更新')
      setTimeout(() => setMsg(''), 2000)
    }
  }

  const deleteContact = async (id) => {
    await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' })
    fetchContacts()
    setMsg('联系人已删除')
    setTimeout(() => setMsg(''), 2000)
  }

  const methodLabel = (v) => NOTIFY_METHODS.find(m => m.value === v)?.label || '未知'

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
          <span>当前状态</span>
          <span>{user.status === 'push' ? '推送期限（宽限期）' : '预警期限'}</span>
        </div>
        <div className="stat-row">
          <span>预警期限</span>
          <span>{user.alert_interval_days || user.checkin_interval_days} 天</span>
        </div>
        <div className="stat-row">
          <span>推送期限</span>
          <span>{user.push_interval_days || '-'} 天</span>
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

      <div className="card contacts-card">
        <div className="contacts-header">
          <h3>紧急联系人</h3>
          {!showAddContact && !editingContact && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowAddContact(true)}>添加</button>
          )}
        </div>

        {showAddContact && (
          <ContactForm
            submitLabel="添加"
            onSubmit={addContact}
            onCancel={() => setShowAddContact(false)}
          />
        )}

        {editingContact && (
          <ContactForm
            initial={editingContact}
            submitLabel="保存"
            onSubmit={updateContact}
            onCancel={() => setEditingContact(null)}
          />
        )}

        {contacts.length === 0 && !showAddContact && (
          <p className="empty" style={{ padding: '16px 0' }}>暂无紧急联系人，请添加</p>
        )}

        <div className="contact-list">
          {contacts.map(c => (
            <div key={c.id} className="contact-item">
              <div className="contact-info">
                <span className="contact-name">{c.name}</span>
                <span className={`badge badge-${c.notify_method === 1 ? '1' : '2'}`}>
                  {methodLabel(c.notify_method)}
                </span>
              </div>
              <div className="contact-target">{c.notify_target}</div>
              <div className="contact-actions">
                <button className="btn btn-sm" onClick={() => { setEditingContact(c); setShowAddContact(false) }}>编辑</button>
                <button className="btn btn-sm btn-danger" onClick={() => deleteContact(c.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn-danger" style={{ width: '100%', marginTop: 16 }} onClick={onLogout}>退出登录</button>
    </div>
  )
}
