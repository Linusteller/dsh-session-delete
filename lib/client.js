/**
 * dsh-delete-sessions - the browser half.
 *
 * 在侧栏每个会话的「…」菜单里加一个**红色**的「删除会话」项，位置在
 * 「归档会话」(order 400) 正下方、「复制 Session ID」(order 450) 之上（order 410）。
 *
 * 菜单项沿用宿主 MenuItemButton + Fluent 图标，并带 `danger: true` 让整行按
 * 宿主的危险色（`--dsw-alias-state-error-primary`）着色——与「删除工作区」
 * 走同一条路径，因此颜色/间距/字号天然一致。
 *
 * 确认对话框放在**`shell.overlay` 槽**，而不是菜单项组件内部：
 * 菜单项一旦被点击就会 `setMenuOpen(false)` 关闭菜单、整个组件随之卸载，
 * 若把 Modal 渲染在它里面，弹窗会刚出现就被销毁（这正是"点了没反应"的原因）。
 * 这里照搬宿主「归档确认」的结构：
 *   - 插件作用域里 `createSnapshotStore(null)` 保存「待确认请求」；
 *   - 菜单项通过槽的 `inject` 拿到该 store，点击时只做 `store.set({...})`；
 *   - `shell.overlay` 注册一个常驻组件，通过 `hooks: { deleteRequest }` 拿到
 *     `useDeleteRequest` hook，有请求时渲染 Modal。
 *
 * 确认后 POST 到宿主路由 `/plugins/dsh-delete-sessions/delete`，成功后宿主
 * 广播 `api-session/removed`，列表行自动消失。
 *
 * 手写 CommonJS 形状的浏览器 bundle（同 dsh-plugin-poker）：
 * `window.__ModuleLoader__.load({id, factory})`，`require` 平台注入的
 * `react`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-store`。
 *
 * @module dsh-delete-sessions/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-delete-sessions',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { MenuItemButton, Modal, Button, IconTrashOutlineRegular } = primitives;
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');

    /** 宿主删除路由（同源）。 */
    const DELETE_SESSION_PATH = '/plugins/dsh-delete-sessions/delete';

    /** 危险按钮 / 辅助文字样式类名（样式由下方 style 标签注入）。 */
    const DANGER_BUTTON_CLASS = 'dsh-delete-sessions-danger';
    const DIALOG_META_CLASS = 'dsh-delete-sessions-meta';
    const STYLE_ID = 'dsh-delete-sessions-style';

    /** 只注入一次样式：危险色取宿主自己的语义变量，跟随主题。 */
    function ensureStyle() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = [
        '.' + DANGER_BUTTON_CLASS + ':not(:disabled){',
        '  color: var(--dsw-alias-state-error-primary);',
        '  border-color: var(--dsw-alias-state-error-primary);',
        '}',
        '.' + DANGER_BUTTON_CLASS + ':not(:disabled):hover{',
        '  background: var(--dsw-alias-state-error-primary);',
        '  color: var(--dsw-alias-label-on-primary, #fff);',
        '}',
        '.' + DIALOG_META_CLASS + '{',
        '  margin-top: 12px;',
        '  font-size: 12px;',
        '  line-height: 18px;',
        '  color: var(--dsw-alias-label-tertiary);',
        '  word-break: break-all;',
        '}',
      ].join('\n');
      document.head.appendChild(style);
    }

    /**
     * 删除确认对话框（`shell.overlay` 的常驻宿主）。
     *
     * `useDeleteRequest` 由槽的 `hooks: { deleteRequest }` 注入；没有待确认
     * 请求时返回 null，因此它不占用界面，也不会随会话菜单开关而卸载。
     */
    function DeleteSessionDialog({ useDeleteRequest, dismissDeleteRequest }) {
      const request = useDeleteRequest((pending) => pending);
      const [deleting, setDeleting] = React.useState(false);
      const [error, setError] = React.useState(null);

      React.useEffect(() => { ensureStyle(); }, []);

      const sessionId = request === null ? null : request.sessionId;

      // 换一个待确认会话（或关闭）时，清掉上一次的进行中/错误状态。
      React.useEffect(() => {
        setDeleting(false);
        setError(null);
      }, [sessionId]);

      if (request === null) return null;

      const title = (request.displayTitle && String(request.displayTitle).trim() !== '')
        ? String(request.displayTitle)
        : sessionId;

      const close = () => {
        if (deleting) return;
        dismissDeleteRequest();
      };

      const confirm = () => {
        if (deleting) return;
        setDeleting(true);
        setError(null);
        fetch(DELETE_SESSION_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.ok !== true) {
              const msg = (data && data.error) ? data.error : ('HTTP ' + response.status);
              setError(msg);
              setDeleting(false);
              return;
            }
            // 成功：宿主广播 api-session/removed，行自动卸载；这里收起对话框。
            dismissDeleteRequest();
          })
          .catch((thrown) => {
            setError(thrown && thrown.message ? thrown.message : String(thrown));
            setDeleting(false);
          });
      };

      return React.createElement(Modal, {
        open: true,
        onClose: close,
        closeLabel: '关闭',
        title: '删除会话',
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, {
            variant: 'outline',
            disabled: deleting,
            onClick: close,
            children: '取消',
          }),
          React.createElement(Button, {
            variant: 'outline',
            className: DANGER_BUTTON_CLASS,
            disabled: deleting,
            onClick: confirm,
            children: deleting ? '删除中…' : '确定删除',
          })),
        children: [
          React.createElement('div', { key: 'desc' },
            '将永久删除该会话及其全部对话记录（会话日志、投影缓存与工作区记账），此操作不可恢复。'),
          React.createElement('div', { key: 'title', className: DIALOG_META_CLASS },
            '会话：' + title),
          React.createElement('div', { key: 'id', className: DIALOG_META_CLASS },
            '序列号：' + sessionId),
          error === null ? null : React.createElement('div', {
            key: 'err',
            className: DIALOG_META_CLASS,
            style: { color: 'var(--dsw-alias-state-error-primary)' },
            role: 'alert',
          }, '删除失败：' + error),
        ],
      });
    }

    /**
     * 会话「…」菜单里的「删除会话」项（红色）。
     *
     * 只负责收起菜单并把请求交给插件级 store——对话框由 `shell.overlay`
     * 里的常驻组件渲染，所以菜单关闭不会把弹窗一起带走。
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, deleteRequest }) {
      const [, setMenuOpen] = useMenuOpenState ? useMenuOpenState() : [null, () => {}];

      const onSelect = () => {
        setMenuOpen(false);
        deleteRequest.set({ sessionId, displayTitle: displayTitle ?? null });
      };

      return React.createElement(MenuItemButton, {
        icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
        danger: true,
        onSelect,
        children: '删除会话',
      });
    }

    /** 注册菜单项与浮层对话框；slots 服务缺失时静默降级。 */
    function apply(ctx) {
      try {
        const slots = ctx.get ? ctx.get('slots') : undefined;
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          if (typeof console !== 'undefined') console.warn('[dsh-delete-sessions] slots unavailable, entries not registered');
          return;
        }

        /**
         * 待确认的删除请求。用宿主的 snapshot store（而不是组件 state），
         * 让「菜单项」与「浮层对话框」两个互不相关的组件共享同一份状态；
         * 它活在插件作用域里，菜单开关不影响它。
         */
        const deleteRequest = createSnapshotStore(null);

        // order 410：恰在「归档会话」(400) 之下、「复制 Session ID」(450) 之上。
        slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'delete-session',
            order: 410,
            inject: () => ({ deleteRequest }),
          }, DeleteSessionMenuItem);
        });

        // 常驻浮层：菜单项卸载后对话框仍然存在。
        slots.inject('shell.overlay', function* () {
          yield slots.register({
            name: 'shell.overlay',
            id: 'dsh-delete-sessions-confirm',
            inject: () => ({
              hooks: { deleteRequest },
              dismissDeleteRequest: () => deleteRequest.set(null),
            }),
          }, DeleteSessionDialog);
        });

        if (typeof console !== 'undefined') console.info('[dsh-delete-sessions] client half active');
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[dsh-delete-sessions] failed to register entries', error);
      }
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
