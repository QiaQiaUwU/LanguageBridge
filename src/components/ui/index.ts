import type { App } from 'vue'
import BackLink from './BackLink.vue'
import FoldToggle from './FoldToggle.vue'
import StarToggle from './StarToggle.vue'
import BookmarkToggle from './BookmarkToggle.vue'
import DoneToggle from './DoneToggle.vue'
import CloseButton from './CloseButton.vue'
import EmptyState from './EmptyState.vue'
import SearchBox from './SearchBox.vue'
import UiDialog from './UiDialog.vue'

/** 全局注册，页面里直接用，不用逐个 import */
export function installUi(app: App) {
  app.component('BackLink', BackLink)
  app.component('FoldToggle', FoldToggle)
  app.component('StarToggle', StarToggle)
  app.component('BookmarkToggle', BookmarkToggle)
  app.component('DoneToggle', DoneToggle)
  app.component('CloseButton', CloseButton)
  app.component('EmptyState', EmptyState)
  app.component('SearchBox', SearchBox)
  app.component('UiDialog', UiDialog)
}

export { BackLink, FoldToggle, StarToggle, BookmarkToggle, DoneToggle, CloseButton, EmptyState, SearchBox, UiDialog }
