/**
 * dsh-delete-sessions - the browser half.
 *
 * 在侧栏每个会话的「…」菜单里加一个「删除会话」项。位置放在「归档会话」
 * (order 400) 正下方、「复制 Session ID」(order 450) 上方，即 order 410。
 *
 * 渲染完全沿用宿主的 MenuItemButton 原语与 Fluent 图标（`IconTrashOutlineRegular`，
 * 与 DSH 删除工作区的图标同款），因此风格、间距、字号与原有的 pin / rename /
 * fork / archive / session-id 五个菜单项完全一致——文本、图标、快捷键位的
 * 排版全部由宿主统一绘制。
 *
 * 点击后先收起菜单并弹确认，确认则 POST 到宿主路由
 * `/plugins/dsh-delete-sessions/delete`，成功后宿主广播 `api-session/removed`，
 * 列表行自动消失——本组件无需自己操作列表。
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
    const { MenuItemButton, IconTrashOutlineRegular } = primitives;

    /** 宿主删除路由（同源）。 */
    const DELETE_SESSION_PATH = '/plugins/dsh-delete-sessions/delete';

    /**
     * 会话「…」菜单里的「删除会话」项。
     *
     * props 与宿主注册的其余菜单项一致：`sessionId` + `displayTitle` 来自
     * owner share，`useMenuOpenState` 来自该菜单槽注入的 hook context。
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState ? useMenuOpenState() : [null, () => {}];
      const [busy, setBusy] = React.useState(false);

      const onSelect = () => {
        setMenuOpen(false);
        if (busy) return;
        const title = (displayTitle && displayTitle.trim() !== '') ? displayTitle : sessionId;
        const ok = window.confirm(
          '确定永久删除会话「' + title + '」吗？\n\n此操作不可撤销，会话记录及其日志文件将被彻底删除。',
        );
        if (!ok) return;
        setBusy(true);
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
              window.alert('删除失败：' + msg);
              setBusy(false);
              return;
            }
            // 成功：宿主广播 api-session/removed，行自动卸载，组件随行销毁。
          })
          .catch((error) => {
            window.alert('删除失败：' + (error && error.message ? error.message : String(error)));
            setBusy(false);
          });
      };

      return React.createElement(MenuItemButton, {
        icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
        onSelect,
        children: busy ? '删除中…' : '删除会话',
      });
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
