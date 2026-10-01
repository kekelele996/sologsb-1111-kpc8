import { create } from 'zustand';
import type { DepthBasis } from '../utils/survey';

const STORAGE_KEY = 'gbdrillcore-depth-basis';

function readInitial(): DepthBasis {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'md' || v === 'tvd') return v;
  } catch {
    /* localStorage 不可用时退回孔深 */
  }
  return 'md';
}

interface DepthBasisState {
  /** 深度基准：md 孔深 / tvd 垂深（仅影响显示，录入始终按孔深） */
  basis: DepthBasis;
  setBasis: (basis: DepthBasis) => void;
  toggle: () => void;
}

/** 深度基准切换：工作台剖面、深度覆盖、岩芯箱连续性、柱状图按基准显示 */
export const useDepthBasisStore = create<DepthBasisState>()((set, get) => ({
  basis: readInitial(),
  setBasis: (basis) => {
    try {
      localStorage.setItem(STORAGE_KEY, basis);
    } catch {
      /* 忽略持久化失败 */
    }
    set({ basis });
  },
  toggle: () => set({ basis: get().basis === 'md' ? 'tvd' : 'md' }),
}));
