import { useState, useEffect } from 'react'
import { apiFetch, apiFetchJson } from '../api'

const PUSH_METHODS = [
  { value: 1, label: '电子邮件' },
  { value: 2, label: '手机短信' },
  { value: 3, label: '实体邮信' },
  { value: 4, label: '公开到社区' },
]

function Modal({ children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function PasswordModal({ onVerified, onClose, isSet, externalError }) {
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!isSet) {
      if (password.length < 4) { setError('密码至少4位'); return }
      if (password !== confirmPwd) { setError('两次密码不一致'); return }
      onVerified(password)
    } else {
      onVerified(password)
    }
  }

  const displayError = error || externalError

  return (
    <Modal onClose={onClose}>
      <h3>{isSet ? '输入密码' : '设置查看密码'}</h3>
      <p className="modal-hint">{isSet ? '查看信件需要验证密码' : '首次查看信件，请设置一个密码'}</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder={isSet ? '请输入密码' : '设置密码（至少4位）'}
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); onVerified(null) }}
          autoFocus
        />
        {!isSet && (
          <input
            type="password"
            placeholder="确认密码"
            value={confirmPwd}
            onChange={e => { setConfirmPwd(e.target.value); setError('') }}
            style={{ marginTop: 8 }}
          />
        )}
        {displayError && <div className="modal-error">{displayError}</div>}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" type="submit">确认</button>
          <button className="btn" type="button" onClick={onClose}>取消</button>
        </div>
      </form>
    </Modal>
  )
}

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <Modal onClose={onCancel}>
      <h3>{title}</h3>
      <p className="modal-hint">{message}</p>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-danger" onClick={onConfirm}>确认删除</button>
        <button className="btn" onClick={onCancel}>取消</button>
      </div>
    </Modal>
  )
}

export default function LettersPage({ userId }) {
  const [letters, setLetters] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', pushMethod: 1, pushTarget: '', password: '' })
  const [msg, setMsg] = useState('')
  const [viewingLetter, setViewingLetter] = useState(null)
  const [editingLetter, setEditingLetter] = useState(null)
  const [editForm, setEditForm] = useState({ title: '', content: '', pushMethod: 1, pushTarget: '', password: '' })
  const [pwdModalTarget, setPwdModalTarget] = useState(null)
  const [pwdError, setPwdError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const fetchLetters = async () => {
    try {
      const data = await apiFetchJson('/api/letters')
      setLetters(data)
    } catch {}
  }

  useEffect(() => { fetchLetters() }, [])

  const createLetter = async (e) => {
    e.preventDefault()
    try {
      const data = await apiFetchJson('/api/letters', {
        method: 'POST',
        body: JSON.stringify({ ...form }),
      })
      if (data.success) {
        setForm({ title: '', content: '', pushMethod: 1, pushTarget: '', password: '' })
        setShowForm(false)
        fetchLetters()
        setMsg('信件已保存')
      }
    } catch (e) {
      alert(e.message || '保存失败')
    }
    setTimeout(() => setMsg(''), 2000)
  }

  const updateLetter = async () => {
    try {
      const data = await apiFetchJson(`/api/letters/${editingLetter.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editForm.title,
          content: editForm.content,
          pushMethod: editForm.pushMethod,
          pushTarget: editForm.pushTarget,
          password: editForm.password || undefined,
        }),
      })
      if (data.success) {
        setEditingLetter(null)
        setViewingLetter(null)
        fetchLetters()
        setMsg('信件已更新')
      }
    } catch (e) {
      alert(e.message || '更新失败')
    }
    setTimeout(() => setMsg(''), 2000)
  }

  const doDelete = async (id) => {
    try {
      await apiFetchJson(`/api/letters/${id}`, { method: 'DELETE' })
    } catch {}
    setDeleteTarget(null)
    setViewingLetter(null)
    fetchLetters()
  }

  const handleViewLetter = async (letter) => {
    if (letter.has_password) {
      setPwdError('')
      setPwdModalTarget(letter)
      return
    }
    try {
      const verifyData = await apiFetchJson(`/api/letters/${letter.id}/verify`, { method: 'POST' })
      if (!verifyData.verified) return
      const token = verifyData.accessToken
      const data = await apiFetchJson(`/api/letters/${letter.id}`, {
        headers: token ? { 'x-letter-token': token } : {},
      })
      setViewingLetter(data)
    } catch (e) {
      alert(e.message || '查看失败')
    }
  }

  const onPasswordSubmit = async (password) => {
    if (password === null) { setPwdError(''); return }
    try {
      const data = await apiFetchJson(`/api/letters/${pwdModalTarget.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      if (data.verified) {
        const token = data.accessToken
        const letter = await apiFetchJson(`/api/letters/${pwdModalTarget.id}`, {
          headers: token ? { 'x-letter-token': token } : {},
        })
        setViewingLetter(letter)
        setPwdModalTarget(null)
        setPwdError('')
      } else {
        setPwdError('密码错误')
      }
    } catch (e) {
      setPwdError(e.message || '密码错误')
    }
  }

  const startEdit = () => {
    setEditForm({
      title: viewingLetter.title,
      content: viewingLetter.content,
      pushMethod: viewingLetter.push_method,
      pushTarget: viewingLetter.push_target,
      password: '',
    })
    setEditingLetter(viewingLetter)
  }

  const methodLabel = (v) => PUSH_METHODS.find(m => m.value === v)?.label || '未知'

  const parseUTC = (dateStr) => {
    if (!dateStr) return null
    const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    return new Date(utcStr)
  }

  return (
    <div className="page letters-page">
      <div className="page-header">
        <h2>我的信件</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '取消' : '写信'}
        </button>
      </div>

      {showForm && (
        <form className="card letter-form" onSubmit={createLetter}>
          <input
            placeholder="信件标题"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            required
          />
          <textarea
            placeholder="写下你想说的话..."
            rows={6}
            value={form.content}
            onChange={e => setForm({ ...form, content: e.target.value })}
            required
          />
          <div className="form-row">
            <label>推送方式</label>
            <select
              value={form.pushMethod}
              onChange={e => setForm({ ...form, pushMethod: Number(e.target.value) })}
            >
              {PUSH_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <input
            placeholder={form.pushMethod === 1 ? '邮箱地址' : form.pushMethod === 2 ? '手机号码' : form.pushMethod === 3 ? '邮寄地址' : '（公开到社区无需填写）'}
            value={form.pushTarget}
            onChange={e => setForm({ ...form, pushTarget: e.target.value })}
            required={form.pushMethod !== 4}
          />
          <input
            type="password"
            placeholder="查看密码（可选，保护信件隐私）"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
          />
          <button className="btn btn-primary" type="submit">保存信件</button>
        </form>
      )}

      {msg && <div className="msg">{msg}</div>}

      <div className="letter-list">
        {letters.length === 0 && <div className="empty">还没有信件，点击"写信"开始</div>}
        {letters.map(letter => (
          <div key={letter.id} className="card letter-card" onClick={() => handleViewLetter(letter)}>
            <div className="letter-header">
              <strong>{letter.title}</strong>
              <div className="letter-badges">
                <span className={`badge badge-${letter.push_method}`}>
                  {methodLabel(letter.push_method)}
                </span>
                {letter.is_sent ? (
                  <span className="badge badge-sent">已送达</span>
                ) : (
                  <span className="badge badge-pending">待发送</span>
                )}
                {letter.has_password && <span className="badge badge-lock">🔒</span>}
              </div>
            </div>
            <p className="letter-preview">
              {letter.is_sent && letter.sent_at
                ? `已于 ${parseUTC(letter.sent_at)?.toLocaleString()} 送达`
                : '点击查看完整内容'}
            </p>
            <div className="letter-footer">
              <span className="letter-date">{parseUTC(letter.created_at).toLocaleDateString()}</span>
              <button
                className="btn btn-danger btn-sm"
                onClick={e => { e.stopPropagation(); setDeleteTarget(letter.id) }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {pwdModalTarget && (
        <PasswordModal
          isSet={!!pwdModalTarget.has_password}
          onVerified={onPasswordSubmit}
          onClose={() => { setPwdModalTarget(null); setPwdError('') }}
          externalError={pwdError}
        />
      )}

      {viewingLetter && !editingLetter && (
        <Modal onClose={() => setViewingLetter(null)}>
          <h3>{viewingLetter.title}</h3>
          <span className={`badge badge-${viewingLetter.push_method}`} style={{ marginBottom: 8 }}>
            {methodLabel(viewingLetter.push_method)}
          </span>
          <div className="letter-full-content">{viewingLetter.content}</div>
          <div className="letter-meta">
            <span>推送目标：{viewingLetter.push_target || '无'}</span>
            <span>创建时间：{parseUTC(viewingLetter.created_at).toLocaleString()}</span>
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={startEdit}>编辑</button>
            <button className="btn" onClick={() => setViewingLetter(null)}>关闭</button>
          </div>
        </Modal>
      )}

      {editingLetter && (
        <Modal onClose={() => { setEditingLetter(null); setViewingLetter(null) }}>
          <h3>编辑信件</h3>
          <div className="letter-edit-form">
            <input
              value={editForm.title}
              onChange={e => setEditForm({ ...editForm, title: e.target.value })}
            />
            <textarea
              rows={8}
              value={editForm.content}
              onChange={e => setEditForm({ ...editForm, content: e.target.value })}
            />
            <div className="form-row">
              <label>推送方式</label>
              <select
                value={editForm.pushMethod}
                onChange={e => setEditForm({ ...editForm, pushMethod: Number(e.target.value) })}
              >
                {PUSH_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <input
              value={editForm.pushTarget}
              onChange={e => setEditForm({ ...editForm, pushTarget: e.target.value })}
              placeholder="推送目标"
            />
            <input
              type="password"
              value={editForm.password}
              onChange={e => setEditForm({ ...editForm, password: e.target.value })}
              placeholder={editingLetter.password ? '留空保持原密码' : '设置查看密码（可选）'}
            />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={updateLetter}>保存</button>
              <button className="btn" onClick={() => setEditingLetter(null)}>取消</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="确认删除"
          message="确定要删除这封信吗？删除后不可恢复。"
          onConfirm={() => doDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
