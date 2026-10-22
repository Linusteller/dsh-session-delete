/**
 * dsh-delete-sessions - the browser half.
 *
 * 在侧栏每个会话的「…」菜单里加一个**红色**的「删除会话」项。位置放在
 * 「归档会话」(order 400) 正下方、「复制 Session ID」(order 450) 上方，即 order 410。
 *
 * 渲染完全沿用宿主的 MenuItemButton 原语与 Fluent 图标（`IconTrashOutlineRegular`，
 * 与 DSH 删除工作区的图标同款），并用 `danger: true` 让菜单项按宿主的危险色
 * （`--dsw-alias-state-error-primary`）着色——这与「删除工作区」菜单项同一条路径，
 * 因此颜色、间距、字号都跟宿主原生危险项一致。
 *
 * 点击后不再用 `window.confirm`（系统原生弹窗，观感粗糙、暴露内部包名），而是用
 * 宿主的 `Modal` + `Button` 原语画一个与「归档确认」「删除工作区确认」同款的自定义
 * 对话框：标题「删除会话」，正文说明不可恢复，底部「取消」+ 红色「确定删除」。
 *
 * 确认后 POST 到宿主路由 `/plugins/dsh-delete-sessions/delete`，成功后宿主广播
 * `api-session/removed`，列表行自动消失——本组件无需自己操作列表。
 *
 * 手写 CommonJS 形状的浏览器 bundle（同 dsh-plugin-poker 的 client 形态）：
 * 只在 `window.__ModuleLoader__` 上注册一个 factory，`require` 平台注入的
 * `react` 与 `@deepseek-ai/dsh-client-ui-primitives`，导出 `apply`/`inject`。
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

    /** 宿主删除路由（同源）。 */
    const DELETE_SESSION_PATH = '/plugins/dsh-delete-sessions/delete';

    /** 危险按钮样式类名（本插件自带，样式由下方 style 标签注入）。 */
    const DANGER_BUTTON_CLASS = 'dsh-delete-sessions-danger';
    const DIALOG_META_CLASS = 'dsh-delete-sessions-meta';

    /** 只注入一次样式：危险色取宿主自己的语义变量，跟随主题。 */
    const STYLE_ID = 'dsh-delete-sessions-style';
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

    /** 当前会话标题：优先用列表给的 displayTitle，缺失时退回 id。 */
    function titleOf(sessionId, displayTitle) {
      return (displayTitle && displayTitle.trim() !== '') ? displayTitle : sessionId;
    }

    /**
     * 删除确认对话框：宿主 Modal + 取消/确定删除两个按钮。
     * 与「归档会话」的确认框同构（open/onClose/title/description/footer）。
     */
    function DeleteSessionDialog({ sessionId, displayTitle, onClose }) {
      const [deleting, setDeleting] = React.useState(false);
      const [error, setError] = React.useState(null);

      const close = () => {
        if (deleting) return;
        onClose();
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
            // 成功：宿主广播 api-session/removed，行自动卸载，对话框随行一起消失。
            onClose();
          })
          .catch((thrown) => {
            setError(thrown && thrown.message ? thrown.message : String(thrown));
            setDeleting(false);
          });
      };

      const body = [
        React.createElement('div', { key: 'desc' },
          '将永久删除该会话及其全部对话记录（会话日志、投影缓存与工作区记账），此操作不可恢复。'),
        React.createElement('div', { key: 'meta', className: DIALOG_META_CLASS },
          '会话：' + titleOf(sessionId, displayTitle)),
        React.createElement('div', { key: 'id', className: DIALOG_META_CLASS },
          '序列号：' + sessionId),
        error === null ? null : React.createElement('div', {
          key: 'err',
          className: DIALOG_META_CLASS,
          style: { color: 'var(--dsw-alias-state-error-primary)' },
          role: 'alert',
        }, '删除失败：' + error),
      ];

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
        children: body,
      });
    }

    /**
     * 会话「…」菜单里的「删除会话」项（红色）。
     *
     * props 与宿主注册的其余菜单项一致：`sessionId` + `displayTitle` 来自
     * owner share，`useMenuOpenState` 来自该菜单槽注入的 hook context。
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState ? useMenuOpenState() : [null, () => {}];
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => { ensureStyle(); }, []);

      const onSelect = () => {
        setMenuOpen(false);
        setOpen(true);
      };

      return React.createElement(React.Fragment, null,
        React.createElement(MenuItemButton, {
          icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
          danger: true,
          onSelect,
          children: '删除会话',
        }),
        open
          ? React.createElement(DeleteSessionDialog, {
              sessionId,
              displayTitle,
              onClose: () => setOpen(false),
            })
          : null);
    }

    /** 注册菜单项；slots 服务缺失时静默降级。 */
    function apply(ctx) {
      try {
        const slots = ctx.get ? ctx.get('slots') : undefined;
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          if (typeof console !== 'undefined') console.warn('[dsh-delete-sessions] slots unavailable, menu item not registered');
          return;
        }
        // order 410：恰在「归档会话」(400) 之下、「复制 Session ID」(450) 之上。
        slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield slots.register({
            name: 'sidebar.workspaces.session.menu.item',
            id: 'delete-session',
            order: 410,
          }, DeleteSessionMenuItem);
        });
        if (typeof console !== 'undefined') console.info('[dsh-delete-sessions] client half active');
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[dsh-delete-sessions] failed to register menu item', error);
      }
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  },
});
