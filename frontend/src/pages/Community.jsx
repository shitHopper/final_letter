import { useState, useEffect, useRef } from 'react'
import { apiFetch, apiFetchJson } from '../api'

export default function CommunityPage({ userId }) {
  const [posts, setPosts] = useState([])
  const [newPost, setNewPost] = useState('')
  const [newImages, setNewImages] = useState([])
  const [imagePreviews, setImagePreviews] = useState([])
  const [comments, setComments] = useState({})
  const [openComments, setOpenComments] = useState(null)
  const [newComment, setNewComment] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [alertModal, setAlertModal] = useState(null)
  const [viewingUser, setViewingUser] = useState(null)
  const [userCardPos, setUserCardPos] = useState({ x: 0, y: 0 })
  const fileInputRef = useRef(null)

  const handleViewUser = async (userId, e) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const cardWidth = 240
    const cardHeight = 180
    let x = rect.left
    let y = rect.bottom + 6
    if (x + cardWidth > window.innerWidth) x = window.innerWidth - cardWidth - 8
    if (y + cardHeight > window.innerHeight) y = rect.top - cardHeight - 6
    if (x < 8) x = 8
    setUserCardPos({ x, y })
    try {
      const data = await apiFetchJson(`/api/users/${userId}`)
      setViewingUser(data)
    } catch (e) { console.error('获取用户信息失败:', e) }
  }

  const fetchPosts = async () => {
    try {
      const data = await apiFetchJson('/api/posts')
      setPosts(data)
    } catch (e) { console.error('获取帖子失败:', e) }
  }

  useEffect(() => { fetchPosts() }, [])

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    const remaining = 9 - newImages.length
    const toAdd = files.slice(0, remaining)
    setNewImages(prev => [...prev, ...toAdd])
    toAdd.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => setImagePreviews(prev => [...prev, ev.target.result])
      reader.readAsDataURL(file)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (index) => {
    setNewImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviews(prev => prev.filter((_, i) => i !== index))
  }

  const uploadImage = async (file) => {
    const formData = new FormData()
    formData.append('image', file)
    const data = await apiFetchJson('/api/upload', { method: 'POST', body: formData })
    return data.url
  }

  const createPost = async () => {
    if (!newPost.trim() && newImages.length === 0) return
    if (newPost.length > 1000) {
      setAlertModal('帖子内容最多1000个字符')
      return
    }
    setUploading(true)
    try {
      let imageUrls = []
      for (const file of newImages) {
        const url = await uploadImage(file)
        imageUrls.push(url)
      }
      await apiFetchJson('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ content: newPost, imageUrls }),
      })
      setNewPost('')
      setNewImages([])
      setImagePreviews([])
      fetchPosts()
    } catch (e) {
      alert(e.message || '发布失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const parseImageUrls = (imageUrl) => {
    if (!imageUrl) return []
    try {
      const parsed = JSON.parse(imageUrl)
      if (Array.isArray(parsed)) return parsed
    } catch { /* 非 JSON，按旧格式处理 */ }
    return imageUrl ? [imageUrl] : []
  }

  const toggleLike = async (postId) => {
    try {
      const data = await apiFetchJson(`/api/posts/${postId}/like`, {
        method: 'POST',
      })
      if (data.success) {
        fetchPosts()
      }
    } catch (e) { console.error('点赞失败:', e) }
  }

  const fetchComments = async (postId) => {
    if (openComments === postId) {
      setOpenComments(null)
      setReplyTo(null)
      return
    }
    try {
      const data = await apiFetchJson(`/api/posts/${postId}/comments`)
      setComments(prev => ({ ...prev, [postId]: data }))
      setOpenComments(postId)
      setReplyTo(null)
    } catch (e) { console.error('获取评论失败:', e) }
  }

  const addComment = async (postId) => {
    if (!newComment.trim()) return
    if (newComment.length > 300) {
      setAlertModal('评论最多300个字符')
      return
    }
    const payload = { content: newComment }
    if (replyTo) {
      payload.replyToId = replyTo.id
    }
    try {
      await apiFetchJson(`/api/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setNewComment('')
      setReplyTo(null)
      const data = await apiFetchJson(`/api/posts/${postId}/comments`)
      setComments(prev => ({ ...prev, [postId]: data }))
      fetchPosts()
    } catch (e) {
      alert(e.message || '评论失败')
    }
  }

  const handleReply = (comment) => {
    setReplyTo({ id: comment.id, nickname: comment.nickname })
  }

  const deletePost = async (postId) => {
    try { await apiFetchJson(`/api/posts/${postId}`, { method: 'DELETE' }) } catch (e) { console.error('删除帖子失败:', e) }
    setConfirmDelete(null)
    fetchPosts()
  }

  const deleteComment = async (commentId, postId) => {
    try { await apiFetchJson(`/api/comments/${commentId}`, { method: 'DELETE' }) } catch (e) { console.error('删除评论失败:', e) }
    setConfirmDelete(null)
    try {
      const data = await apiFetchJson(`/api/posts/${postId}/comments`)
      setComments(prev => ({ ...prev, [postId]: data }))
    } catch (e) { console.error('刷新评论失败:', e) }
    fetchPosts()
  }

  const buildCommentTree = (flatComments) => {
    const map = {}
    const roots = []
    flatComments.forEach(c => { map[c.id] = { ...c, replies: [], replyToNickname: null } })
    flatComments.forEach(c => {
      if (c.reply_to_id && map[c.reply_to_id]) {
        let rootId = c.reply_to_id
        while (map[rootId]?.reply_to_id && map[map[rootId].reply_to_id]) {
          rootId = map[rootId].reply_to_id
        }
        map[c.id].replyToNickname = map[c.reply_to_id].nickname
        map[rootId].replies.push(map[c.id])
      } else {
        roots.push(map[c.id])
      }
    })
    return roots
  }

  const formatTime = (dateStr) => {
    const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
    const d = new Date(utcStr)
    const now = new Date()
    const diff = now - d
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    if (diff < 172800000) return `昨天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const renderComment = (comment, postId) => (
    <div key={comment.id} className="comment">
      <div className="comment-main">
        {comment.avatar_url ? (
          <img src={comment.avatar_url} alt="" className="comment-avatar" onClick={(e) => handleViewUser(comment.user_id, e)} />
        ) : (
          <span className="comment-avatar-initial" onClick={(e) => handleViewUser(comment.user_id, e)}>{comment.nickname[0]}</span>
        )}
        <strong className="comment-author" onClick={(e) => handleViewUser(comment.user_id, e)}>{comment.nickname}</strong>
        <span className="comment-text">{comment.content}</span>
        <span className="comment-time">{formatTime(comment.created_at)}</span>
        <button className="btn btn-ghost reply-btn" onClick={() => handleReply(comment)}>回复</button>
        {comment.user_id === userId && (
          <button className="btn btn-ghost reply-btn delete-comment-btn" onClick={() => setConfirmDelete({ type: 'comment', id: comment.id, postId })}>删除</button>
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="replies">
          {comment.replies.map(r => (
            <div key={r.id} className="reply">
              {r.avatar_url ? (
                <img src={r.avatar_url} alt="" className="comment-avatar comment-avatar-sm" onClick={(e) => handleViewUser(r.user_id, e)} />
              ) : (
                <span className="comment-avatar-initial comment-avatar-initial-sm" onClick={(e) => handleViewUser(r.user_id, e)}>{r.nickname[0]}</span>
              )}
              <strong className="reply-author" onClick={(e) => handleViewUser(r.user_id, e)}>{r.nickname}</strong>
              {r.replyToNickname && <span className="reply-to">@{r.replyToNickname} </span>}
              <span className="reply-text">{r.content}</span>
              <span className="reply-time">{formatTime(r.created_at)}</span>
              <button className="btn btn-ghost reply-btn" onClick={() => handleReply(r)}>回复</button>
              {r.user_id === userId && (
                <button className="btn btn-ghost reply-btn delete-comment-btn" onClick={() => setConfirmDelete({ type: 'comment', id: r.id, postId })}>删除</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="page community-page">
      <div className="post-composer">
        <textarea
          placeholder="分享你的想法..."
          rows={3}
          value={newPost}
          onChange={e => setNewPost(e.target.value)}
        />
        <div className="composer-actions">
          <div className="image-upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
            <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={newImages.length >= 9}>
              📷 图片 {newImages.length > 0 ? `(${newImages.length}/9)` : ''}
            </button>
            {imagePreviews.map((src, i) => (
              <div key={i} className="image-preview">
                <img src={src} alt="preview" />
                <button className="remove-image" onClick={() => removeImage(i)}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={createPost} disabled={uploading || (!newPost.trim() && newImages.length === 0)}>
            {uploading ? '上传中...' : '发布'}
          </button>
        </div>
      </div>

      <div className="post-list">
        {posts.length === 0 && <div className="empty">社区还没有内容，来发第一条吧</div>}
        {posts.map(post => (
          <div key={post.id} className="card post-card">
            <div className="post-author">
              {post.avatar_url ? (
                <img src={post.avatar_url} alt="" className="post-author-avatar" onClick={(e) => handleViewUser(post.user_id, e)} />
              ) : (
                <span className="post-author-initial" onClick={(e) => handleViewUser(post.user_id, e)}>{post.nickname[0]}</span>
              )}
              <span className="post-author-name" onClick={(e) => handleViewUser(post.user_id, e)}>{post.nickname}</span>
            </div>
            {post.content && <p className="post-content">{post.content}</p>}
            {(() => {
              const imgs = parseImageUrls(post.image_url)
              return imgs.length > 0 && (
                <div className={`post-images post-images-${Math.min(imgs.length, 3)}`}>
                  {imgs.map((url, i) => (
                    <div key={i} className="post-image-item">
                      <img src={url} alt="" />
                    </div>
                  ))}
                </div>
              )
            })()}
            <div className="post-actions">
              <button
                className={`btn btn-ghost like-btn ${post.liked ? 'liked' : ''}`}
                onClick={() => toggleLike(post.id)}
              >
                {post.liked ? '❤️' : '🤍'} {post.likes}
              </button>
              <button className="btn btn-ghost" onClick={() => fetchComments(post.id)}>
                💬 {post.comment_count || 0}
              </button>
              {post.user_id === userId && (
                <button className="btn btn-ghost" onClick={() => setConfirmDelete({ type: 'post', id: post.id })}>🗑️ 删除</button>
              )}
              <span className="post-date">{formatTime(post.created_at)}</span>
            </div>
            {openComments === post.id && (
              <div className="comments-section">
                {buildCommentTree(comments[post.id] || []).map(c => renderComment(c, post.id))}
                <div className="comment-input">
                  {replyTo && (
                    <div className="reply-indicator">
                      回复 @{replyTo.nickname}
                      <button className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>✕</button>
                    </div>
                  )}
                  <div className="comment-input-row">
                    <input
                      placeholder={replyTo ? `回复 @${replyTo.nickname}...` : '写评论...'}
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addComment(post.id)}
                    />
                    <button className="btn btn-sm" onClick={() => addComment(post.id)}>发送</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {viewingUser && (
        <div className="user-card-overlay" onClick={() => setViewingUser(null)}>
          <div className="user-card" style={{ left: userCardPos.x, top: userCardPos.y }} onClick={e => e.stopPropagation()}>
            {viewingUser.avatar_url ? (
              <img src={viewingUser.avatar_url} alt="" className="user-card-avatar" />
            ) : (
              <div className="user-card-avatar-initial">{viewingUser.nickname[0]}</div>
            )}
            <div className="user-card-nickname">{viewingUser.nickname}</div>
            {viewingUser.gender && <div className="user-card-gender">{viewingUser.gender}</div>}
            {viewingUser.signature && <div className="user-card-signature">{viewingUser.signature}</div>}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p className="modal-hint">{confirmDelete.type === 'post' ? '删除后帖子及其所有评论将不可恢复，确定删除？' : '删除后该评论将不可恢复，确定删除？'}</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button className="btn btn-danger" onClick={() => {
                if (confirmDelete.type === 'post') deletePost(confirmDelete.id)
                else deleteComment(confirmDelete.id, confirmDelete.postId)
              }}>确认删除</button>
              <button className="btn" onClick={() => setConfirmDelete(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {alertModal && (
        <div className="modal-overlay" onClick={() => setAlertModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>提示</h3>
            <p className="modal-hint">{alertModal}</p>
            <div className="btn-row" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setAlertModal(null)}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
