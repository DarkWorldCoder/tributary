"""Small X11 input/clipboard probe. Operates only on the supplied test display."""
import ctypes as C
import ctypes.util
import time
P, W, I, U, L = C.c_void_p, C.c_ulong, C.c_int, C.c_uint, C.c_long
x = C.CDLL(ctypes.util.find_library('X11')); xt = C.CDLL(ctypes.util.find_library('Xtst'))
def api(lib, name, args, result=I):
    fn = getattr(lib, name); fn.argtypes = args; fn.restype = result; return fn
open_display = api(x,'XOpenDisplay',[C.c_char_p],P)
root_window = api(x,'XDefaultRootWindow',[P],W)
create = api(x,'XCreateSimpleWindow',[P,W,I,I,U,U,U,W,W],W)
atom = api(x,'XInternAtom',[P,C.c_char_p,I],W)
query = api(x,'XQueryTree',[P,W,C.POINTER(W),C.POINTER(W),C.POINTER(C.POINTER(W)),C.POINTER(U)])
geometry = api(x,'XGetGeometry',[P,W,C.POINTER(W),C.POINTER(I),C.POINTER(I),C.POINTER(U),C.POINTER(U),C.POINTER(U),C.POINTER(U)])
name = api(x,'XFetchName',[P,W,C.POINTER(C.c_char_p)])
free = api(x,'XFree',[P]); flush = api(x,'XFlush',[P]); sync = api(x,'XSync',[P,I])
set_focus = api(x,'XSetInputFocus',[P,W,I,W]); raise_window = api(x,'XRaiseWindow',[P,W])
keysym = api(x,'XStringToKeysym',[C.c_char_p],W); keycode = api(x,'XKeysymToKeycode',[P,W],U)
fake = api(xt,'XTestFakeKeyEvent',[P,U,I,W])
convert = api(x,'XConvertSelection',[P,W,W,W,W,W]); delete = api(x,'XDeleteProperty',[P,W,W])
get_property = api(x,'XGetWindowProperty',[P,W,W,L,L,I,W,C.POINTER(W),C.POINTER(I),C.POINTER(W),C.POINTER(W),C.POINTER(C.POINTER(C.c_ubyte))])
class Attributes(C.Structure):
    _fields_ = [(key,I) for key in ['x','y','width','height','border_width','depth']]+[('visual',P),('root',W)]+[(key,I) for key in ['class_', 'bit_gravity','win_gravity','backing_store']]+[('backing_planes',W),('backing_pixel',W),('save_under',I),('colormap',W),('map_installed',I),('map_state',I),('all_event_masks',L),('your_event_mask',L),('do_not_propagate_mask',L),('override_redirect',I),('screen',P)]
attributes = api(x,'XGetWindowAttributes',[P,W,C.POINTER(Attributes)])
class XError(C.Structure):
    _fields_=[('type',I),('display',P),('resourceid',W),('serial',W),('error_code',C.c_ubyte),('request_code',C.c_ubyte),('minor_code',C.c_ubyte)]
errors=[];enumerating=False
@C.CFUNCTYPE(I,P,C.POINTER(XError))
def handle_error(display,error):
    item=error.contents;errors.append({'code':item.error_code,'request':item.request_code,'enumerating':enumerating});return 0
api(x,'XSetErrorHandler',[type(handle_error)],P)(handle_error)
class Probe:
    def __init__(self):
        self.d = open_display(None)
        if not self.d: raise RuntimeError('Missing test X11 display')
        self.root = root_window(self.d); self.window = create(self.d,self.root,0,0,1,1,0,0,0)
        self.clip = atom(self.d,b'CLIPBOARD',0); self.utf8 = atom(self.d,b'UTF8_STRING',0); self.prop = atom(self.d,b'TRIBUTARY_BENCH_SELECTION',0)
    def windows(self):
        root, parent, children, n = W(),W(),C.POINTER(W)(),U()
        query(self.d,self.root,C.byref(root),C.byref(parent),C.byref(children),C.byref(n))
        global enumerating
        enumerating=True
        result = []
        for j in range(n.value):
            win = children[j]; xx,yy,ww,hh,border,depth = I(),I(),U(),U(),U(),U()
            if not geometry(self.d,win,C.byref(root),C.byref(xx),C.byref(yy),C.byref(ww),C.byref(hh),C.byref(border),C.byref(depth)):continue
            label = C.c_char_p(); name(self.d,win,C.byref(label)); title = label.value.decode('utf8','replace') if label.value else ''
            if label: free(label)
            attr = Attributes(); attributes(self.d,win,C.byref(attr))
            if attr.map_state==2 and ww.value > 500 and hh.value > 300: result.append((win,title,ww.value,hh.value))
        if children: free(children)
        sync(self.d,0);enumerating=False
        return result
    def focus(self, win):
        raise_window(self.d,win); set_focus(self.d,win,1,0); sync(self.d,0)
    def key(self, key, modifiers=()):
        codes = [keycode(self.d,keysym(v.encode())) for v in modifiers]
        code = keycode(self.d,keysym(key.encode()))
        if not code or any(not v for v in codes): raise RuntimeError('Unknown key '+key)
        for value in codes: fake(self.d,value,1,0)
        fake(self.d,code,1,0); fake(self.d,code,0,0)
        for value in reversed(codes): fake(self.d,value,0,0)
        flush(self.d)
    def type(self, text):
        aliases = {'.':'period','/':'slash','_':'underscore','-':'minus',' ':'space'}
        for char in text:
            self.key(aliases.get(char,char),('Shift_L',) if char=='_' or char.isupper() else ())
        sync(self.d,0)
    def clipboard(self, timeout=.25):
        delete(self.d,self.window,self.prop); convert(self.d,self.clip,self.utf8,self.prop,self.window,0); flush(self.d)
        end = time.monotonic()+timeout
        while time.monotonic()<end:
            actual,fmt,n,left,data = W(),I(),W(),W(),C.POINTER(C.c_ubyte)()
            get_property(self.d,self.window,self.prop,0,100000,0,0,C.byref(actual),C.byref(fmt),C.byref(n),C.byref(left),C.byref(data))
            if actual.value:
                value = C.string_at(data,n.value) if fmt.value==8 and not left.value else b''
                if data: free(data)
                return value.decode('utf8','replace')
            if data: free(data)
            time.sleep(.005)
        return None

class XImage(C.Structure):
    _fields_=[(key,I) for key in ['width','height','xoffset','format']]+[('data',P)]+[(key,I) for key in ['byte_order','bitmap_unit','bitmap_bit_order','bitmap_pad','depth','bytes_per_line','bits_per_pixel']]+[(key,W) for key in ['red_mask','green_mask','blue_mask']]+[('obdata',P)]
get_image=api(x,'XGetImage',[P,W,I,I,U,U,W,I],C.POINTER(XImage))
destroy_image=api(x,'XDestroyImage',[C.POINTER(XImage)])
def screenshot(probe, filename):
    from PIL import Image
    image=get_image(probe.d,probe.root,0,0,1280,900,2**64-1,2)
    if not image:raise RuntimeError('No test display image')
    try:
        item=image.contents
        if item.bits_per_pixel!=32 or item.byte_order!=0:raise RuntimeError('Unsupported screenshot pixel format')
        data=C.string_at(item.data,item.bytes_per_line*item.height)
        Image.frombytes('RGB',(item.width,item.height),data,'raw','BGRX',item.bytes_per_line).save(filename)
    finally:destroy_image(image)

def pixels(probe, rectangle=(320,45,640,160)):
    left,top,width,height=rectangle
    image=get_image(probe.d,probe.root,left,top,width,height,2**64-1,2)
    if not image:raise RuntimeError('No display pixels')
    try:return C.string_at(image.contents.data,image.contents.bytes_per_line*height)
    finally:destroy_image(image)
def delta(a,b):return sum(x!=y for x,y in zip(a[::16],b[::16]))

motion=api(xt,'XTestFakeMotionEvent',[P,I,I,I,W]);button=api(xt,'XTestFakeButtonEvent',[P,U,I,W])
def click(probe,xpos=600,ypos=300):
    motion(probe.d,0,xpos,ypos,0);button(probe.d,1,1,0);button(probe.d,1,0,0);sync(probe.d,0)
